/*\
title: $:/plugins/kkterm/host/startup.js
type: application/javascript
module-type: startup

Binds the wiki to KKTerm's host context: theme, locale, lifecycle, readiness.

KKTerm owns the UI locale and palette. This module mirrors the host context onto
the wiki rather than exposing a Module-owned language or theme picker, so the two
can never drift apart.

\*/

"use strict";

exports.name = "kkterm-host";
exports.platforms = ["browser"];
exports.after = ["startup"];
exports.synchronous = true;

var PALETTE_TITLE = "$:/palette";
var DARK_PALETTE = "$:/palettes/SolarFlare";
var LIGHT_PALETTE = "$:/palettes/Vanilla";

// KKTerm ships 14 UI locales. TiddlyWiki's core language plugins are not all
// bundled here, so map only what the packaged wiki can actually render and let
// anything else fall through to English. zh-TW must never resolve to zh-CN.
var LANGUAGE_BY_LOCALE = {
	"zh-TW": "$:/languages/zh-Hant",
	"zh-Hant": "$:/languages/zh-Hant",
	"zh-CN": "$:/languages/zh-Hans",
	"zh-Hans": "$:/languages/zh-Hans"
};

function applyTheme(wiki, theme) {
	wiki.addTiddler({
		title: PALETTE_TITLE,
		text: theme === "dark" ? DARK_PALETTE : LIGHT_PALETTE
	});
}

function applyLocale(wiki, locale) {
	if (!locale) {
		return;
	}
	document.documentElement.lang = locale;
	var language = LANGUAGE_BY_LOCALE[locale];
	if (!language) {
		// Try the base locale (for example "de-DE" -> "de") before giving up.
		var base = String(locale).split("-")[0];
		language = LANGUAGE_BY_LOCALE[base];
	}
	if (language && wiki.tiddlerExists(language)) {
		wiki.addTiddler({ title: "$:/language", text: language });
	}
}

function applyContext(wiki, context) {
	if (!context) {
		return;
	}
	applyTheme(wiki, context.theme);
	applyLocale(wiki, context.locale);
}

exports.startup = function () {
	var host = window.KKTerm;
	if (!host) {
		return;
	}
	var wiki = $tw.wiki;

	host.on("contextChanged", function (context) {
		applyContext(wiki, context);
	});

	// The injected host.context can be a snapshot from an earlier navigation, so
	// take a fresh reading before deciding on theme and language.
	host.getContext().then(
		function (context) {
			applyContext(wiki, context);
			return host.ready();
		},
		function () {
			// Even if context resolution fails the UI is usable; report ready so
			// the host does not tear the Module down at the 15s timeout.
			return host.ready();
		}
	);
};
