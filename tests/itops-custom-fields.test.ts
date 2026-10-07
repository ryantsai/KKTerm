import assert from "node:assert/strict";
import test from "node:test";
import { customFieldErrorTranslation, customFieldLinkChoices, customFieldLinkKey, customFieldNavigationRequest, customFieldRecordValues, customFieldValueValid } from "../src/modules/itops/customFieldModel";
import type { CustomFieldDefinition, CustomFieldLink, CustomFieldSnapshot } from "../src/modules/itops/customFieldTypes";
import type { NetworkMap, Rack, Site } from "../src/types";

const field = (type: CustomFieldDefinition["type"], options: string[] = []): CustomFieldDefinition => ({ id: "f", name: "Circuit", recordKind: "prefix", type, options });

test("custom-field validation messages translate without masking unrelated command failures", () => {
  assert.deepEqual(customFieldErrorTranslation("Choice options must be non-empty and unique"), { key: "itops.customFields.errors.choiceOptions" });
  assert.deepEqual(customFieldErrorTranslation(new Error("Invalid value for custom field 'Provider's circuit'")), { key: "itops.customFields.errors.invalidValue", name: "Provider's circuit" });
  assert.equal(customFieldErrorTranslation("database is locked"), null);
});

test("typed metadata preserves zero and false, distinguishes unset values, and rejects invalid values", () => {
  assert.ok(customFieldValueValid(field("number"), 0));
  assert.ok(customFieldValueValid(field("boolean"), false));
  assert.ok(customFieldValueValid(field("text"), null));
  assert.ok(customFieldValueValid(field("date"), "2028-02-29"));
  assert.ok(customFieldValueValid(field("url"), "https://isp.example/contact"));
  assert.ok(customFieldValueValid(field("select", ["Fiber", "DSL"]), "Fiber"));
  for (const value of ["10", Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(customFieldValueValid(field("number"), value), false);
  for (const value of ["2026-02-29", "2026-04-31", "0000-01-01", "2026-1-1"]) assert.equal(customFieldValueValid(field("date"), value), false);
  for (const value of ["javascript:alert(1)", "file:///C:/secret", "ftp://isp.example/"]) assert.equal(customFieldValueValid(field("url"), value), false);
  assert.equal(customFieldValueValid(field("select", ["Fiber"]), "DSL"), false);
  assert.ok(customFieldValueValid(field("credential"), { kind: "credential", credentialId: "vault-1" }));
  assert.equal(customFieldValueValid(field("credential"), "plaintext-password"), false);
  assert.equal(customFieldValueValid(field("link"), { kind: "connection", connectionId: "" }), false);
  assert.equal(customFieldValueValid(field("link"), { kind: "networkNode", mapId: "m", nodeId: "" }), false);
});

test("record values are scoped by kind and identity and preserve reference objects", () => {
  const snapshot: CustomFieldSnapshot = { fields: [], values: [
    { fieldId: "bandwidth", recordKind: "prefix", recordId: "p1", value: 0 },
    { fieldId: "live", recordKind: "prefix", recordId: "p1", value: false },
    { fieldId: "link", recordKind: "address", recordId: "p1", value: { kind: "connection", connectionId: "c1" } },
    { fieldId: "bandwidth", recordKind: "prefix", recordId: "p2", value: 100 },
  ] };
  assert.deepEqual(customFieldRecordValues(snapshot, "prefix", "p1"), { bandwidth: 0, live: false });
  assert.deepEqual(customFieldRecordValues(snapshot, "address", "p1"), { link: { kind: "connection", connectionId: "c1" } });
  assert.deepEqual(customFieldRecordValues(snapshot, "prefix"), {});
});

test("deep links retain owning rack and map ids so identical local node ids are distinct", () => {
  const one: CustomFieldLink = { kind: "networkNode", mapId: "map1", nodeId: "node1" };
  const two: CustomFieldLink = { kind: "networkNode", mapId: "map2", nodeId: "node1" };
  assert.notEqual(customFieldLinkKey(one), customFieldLinkKey(two));
  assert.deepEqual(customFieldNavigationRequest(one), { destination: "networkMaps", networkMapId: "map1", networkNodeId: "node1" });
  assert.deepEqual(customFieldNavigationRequest({ kind: "rack", siteId: "s", rackId: "r" }), { destination: "serverRooms", siteId: "s", rackId: "r" });
  assert.deepEqual(customFieldNavigationRequest({ kind: "rackItem", siteId: "s", rackId: "r", rackItemId: "d" }), { destination: "serverRooms", siteId: "s", rackId: "r", rackItemId: "d" });
  const choices = customFieldLinkChoices({ connections: [], credentials: [], sites: [{ id: "s", name: "HQ" } as Site], racksBySite: { s: [{ id: "r", name: "R1", items: [{ id: "d", label: "Router" }] } as Rack] }, maps: [{ id: "map1", name: "WAN", graph: { nodes: [{ id: "node1", label: "ISP" }] } } as NetworkMap] });
  assert.deepEqual(choices.map((choice) => choice.value.kind), ["rack", "rackItem", "networkNode"]);
  assert.equal(choices[2].label, "WAN · ISP");
});
