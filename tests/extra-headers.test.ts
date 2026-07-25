import assert from "node:assert/strict";
import test from "node:test";
import {
  isSensitiveExtraHeader,
  parseExtraHeaders,
  serializeExtraHeaders,
} from "../src/ai/extraHeaders";

test("legacy extra-header strings migrate into editor rows", () => {
  assert.deepEqual(parseExtraHeaders('sid=1, "env"="3", Authorization="Bearer secret"'), [
    { name: "sid", value: "1" },
    { name: "env", value: "3" },
    { name: "Authorization", value: "Bearer secret" },
  ]);
});

test("extra-header rows round-trip values containing commas", () => {
  const rows = [
    { name: "Accept-Language", value: "en-US, zh-TW" },
    { name: "X-Environment", value: "staging" },
  ];
  assert.deepEqual(parseExtraHeaders(serializeExtraHeaders(rows)), rows);
});

test("a newly added blank row survives controlled serialization while it is edited", () => {
  assert.deepEqual(parseExtraHeaders(serializeExtraHeaders([{ name: "", value: "" }])), [
    { name: "", value: "" },
  ]);
});

test("sensitive extra headers are recognized by name or bearer value", () => {
  assert.equal(
    isSensitiveExtraHeader({ name: "Authorization", value: "Bearer secret" }),
    true,
  );
  assert.equal(isSensitiveExtraHeader({ name: "X-API-Key", value: "secret" }), true);
  assert.equal(isSensitiveExtraHeader({ name: "X-Custom", value: "Bearer secret" }), true);
  assert.equal(isSensitiveExtraHeader({ name: "X-Environment", value: "production" }), false);
});
