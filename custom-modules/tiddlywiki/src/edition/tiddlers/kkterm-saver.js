/*\
title: $:/plugins/kkterm/host/saver.js
type: application/javascript
module-type: saver

Saves the complete wiki through KKTerm's user-mediated file bridge.

Incremental tiddler persistence is handled by $:/plugins/tiddlywiki/browser-storage.
This saver covers the explicit "save a snapshot" action, writing the full wiki
HTML to a location the user picks in KKTerm's own file dialog. The module never
receives a filesystem path -- only an opaque session token.

\*/

"use strict";

var CHUNK_FALLBACK_BYTES = 1024 * 1024;

function encodeChunk(bytes) {
	var binary = "";
	for (var index = 0; index < bytes.length; index++) {
		binary += String.fromCharCode(bytes[index]);
	}
	return btoa(binary);
}

function writeThroughHost(text, suggestedName) {
	var host = window.KKTerm;
	var bytes = new TextEncoder().encode(text);
	var handle = null;
	return host.files
		.beginSave({ suggestedName: suggestedName })
		.then(function (result) {
			// A null handle means the user dismissed the picker. That is a
			// cancellation, not a failure, so resolve without committing.
			if (!result) {
				return false;
			}
			handle = result;
			var chunkBytes = handle.maxChunkBytes || CHUNK_FALLBACK_BYTES;
			var queue = Promise.resolve();
			for (var offset = 0; offset < bytes.length; offset += chunkBytes) {
				(function (slice) {
					queue = queue.then(function () {
						return host.files.write(handle.token, encodeChunk(slice));
					});
				})(bytes.subarray(offset, offset + chunkBytes));
			}
			return queue
				.then(function () {
					return host.files.commit(handle.token);
				})
				.then(function () {
					return true;
				});
		})
		.catch(function (error) {
			// Abandon the staged temporary file so the existing target survives.
			if (handle) {
				return host.files.close(handle.token).then(function () {
					throw error;
				});
			}
			throw error;
		});
}

var KKTermSaver = function (wiki) {
	this.wiki = wiki;
};

KKTermSaver.prototype.save = function (text, method, callback, options) {
	options = options || {};
	var suggestedName = options.variables && options.variables.filename;
	if (!suggestedName) {
		suggestedName = (this.wiki.getTiddlerText("$:/SiteTitle") || "tiddlywiki").trim();
		suggestedName = suggestedName.replace(/[^A-Za-z0-9._-]+/g, "-") + ".html";
	}
	writeThroughHost(text, suggestedName).then(
		function (saved) {
			if (saved) {
				callback(null);
				if (window.KKTerm.context && window.KKTerm.capabilities !== false) {
					// Best-effort Status Bar confirmation; never block the save.
					try {
						window.KKTerm.ui.notice("Wiki snapshot saved", { kind: "success" });
					} catch (error) {
						/* hostUi not granted -- silent */
					}
				}
			} else {
				// Cancelled: report no error and no success message.
				callback(null);
			}
		},
		function (error) {
			callback((error && error.message) || String(error));
		}
	);
	return true;
};

KKTermSaver.prototype.info = {
	name: "kkterm",
	priority: 5000,
	capabilities: ["save", "download"]
};

exports.canSave = function (wiki) {
	return !!(window.KKTerm && window.KKTerm.files);
};

exports.create = function (wiki) {
	return new KKTermSaver(wiki);
};
