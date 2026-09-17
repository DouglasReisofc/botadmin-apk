import test from "node:test";
import assert from "node:assert/strict";
import { buildAutoResponsePatch } from "../web_panel/src/auto-response-config";

test("unifies autoresponse state with its saved rules and preserves rich content", () => {
  const responseMedia = { mediaType: "image", url: "https://example.test/image.jpg" };
  const responseButtons = { type: "button_reply", buttons: [{ id: "1", text: "Abrir" }] };
  const patch = buildAutoResponsePatch([{ id: "rule-1", source: { responseMedia, responseButtons }, triggers: "Oi, OI; suporte", responseText: " Olá ", matchMode: "contains" }], true);
  assert.equal(patch.commandToggles.autoresposta, true);
  assert.deepEqual(patch.autoResponses[0].triggers, ["oi", "suporte"]);
  assert.equal(patch.autoResponses[0].responseText, "Olá");
  assert.equal(patch.autoResponses[0].responseMedia, responseMedia);
  assert.equal(patch.autoResponses[0].responseButtons, responseButtons);
});

test("allows pausing without deleting existing rules", () => {
  const patch = buildAutoResponsePatch([{ id: "rule-1", source: {}, triggers: "preço", responseText: "R$ 10", matchMode: "equals" }], false);
  assert.equal(patch.commandToggles.autoresposta, false);
  assert.equal(patch.autoResponses.length, 1);
});

test("refuses incomplete rules instead of silently deleting them", () => {
  assert.throws(() => buildAutoResponsePatch([{ id: "new", source: {}, triggers: "", responseText: "", matchMode: "equals" }], true), /gatilho/);
  assert.throws(() => buildAutoResponsePatch([{ id: "new", source: {}, triggers: "oi", responseText: "", matchMode: "equals" }], true), /texto/);
});

test("preserves match-any rules with media only", () => {
  const patch = buildAutoResponsePatch([{ id: "any", source: { matchAnyMessage: true, responseVcard: { name: "Suporte" } }, triggers: "", responseText: "", matchMode: "equals" }], true);
  assert.equal(patch.autoResponses.length, 1);
});

test("requires labels when buttons are enabled", () => {
  assert.throws(() => buildAutoResponsePatch([{ id: "buttons", source: { responseButtons: { type: "button_reply", buttons: [{ id: "1", text: "" }] } }, triggers: "menu", responseText: "", matchMode: "equals" }], true), /botões/);
});
