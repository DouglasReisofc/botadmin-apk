import assert from "node:assert/strict";
import test from "node:test";
import { hasAutomationContent, originalSenderForDeletion } from "../lib/bot-events/message-automation-input";

test("empty EasyZap twin must not consume the complete message automation claim", () => {
  const claimed = new Set<string>();
  const process = (message: Parameters<typeof hasAutomationContent>[0]) => {
    if (!hasAutomationContent(message) || claimed.has("same-message-id")) return false;
    claimed.add("same-message-id");
    return true;
  };
  assert.equal(process({ messageType: "unknown", text: "", caption: "", raw: { eventMessage: { id: "same-message-id", type: "unknown" } } }), false);
  assert.equal(process({ text: "https://s.shopee.com.br/3LQlKTXxCh?share_channel_code=1" }), true);
  assert.equal(process({ text: "https://s.shopee.com.br/3LQlKTXxCh?share_channel_code=1" }), false);
});
test("media, captions and buttons remain actionable", () => {
  for (const message of [{ messageType: "sticker" }, { messageType: "audio" }, { caption: "link" }, { links: ["https://example.com"] }, { buttonResponse: { id: "reply" } }, { raw: { eventMedia: { mimeType: "image/png" } } }]) {
    assert.equal(hasAutomationContent(message), true);
  }
});
test("deletion uses the original LID without converting it into a phone", () => {
  assert.equal(originalSenderForDeletion({ eventSender: { jid: "554792386695@s.whatsapp.net", originalJid: "51226192420995@lid" } }), "51226192420995@lid");
  assert.equal(originalSenderForDeletion({ Info: { Sender: "51226192420995:2@lid", SenderAlt: "554792386695@s.whatsapp.net" } }), "51226192420995@lid");
});
test("quotes, mentions and invalid identities cannot become deletion authors", () => {
  assert.equal(originalSenderForDeletion({ message: { contextInfo: { participant: "99999999@s.whatsapp.net" } }, sender: { originalJid: "120363409782229357@g.us" } }), null);
  assert.equal(originalSenderForDeletion(null, { eventSender: { originalJid: "bad" } }), null);
});
