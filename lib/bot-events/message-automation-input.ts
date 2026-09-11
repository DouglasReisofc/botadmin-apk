type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};

/** An empty normalized envelope must not reserve the ID of its complete twin. */
export function hasAutomationContent(message: {
  text?: string | null;
  caption?: string | null;
  links?: string[];
  messageType?: string | null;
  buttonResponse?: unknown;
  raw?: unknown;
}): boolean {
  if (message.text?.trim() || message.caption?.trim() || message.links?.length || message.buttonResponse) return true;
  const type = message.messageType?.trim().toLowerCase();
  if (type && !["unknown", "message", "text", "conversation", "extendedtextmessage"].includes(type)) return true;
  const raw = record(message.raw);
  // Media-only and interactive messages are actionable even without a caption.
  return [raw.media, raw.eventMedia, raw.interactive, raw.poll, raw.contact, raw.location]
    .some(value => Object.keys(record(value)).length > 0);
}

/** Only sender identity fields; never scan quoted messages or mentions. */
export function originalSenderForDeletion(...sources: unknown[]): string | null {
  const roots = sources.map(record);
  const identities = roots.flatMap(root => [root.eventSender, root.sender, root.Sender].map(record));
  for (const identity of identities) {
    for (const key of ["originalJid", "OriginalJID", "original_jid"]) {
      const value = identity[key];
      if (typeof value === "string" && /^\d+(?::\d+)?@(lid|s\.whatsapp\.net|c\.us)$/i.test(value.trim())) {
        return value.trim().replace(/:\d+(?=@)/, "");
      }
    }
  }
  for (const root of roots) {
    const info = record(root.Info ?? root.info);
    const value = info.Sender;
    if (typeof value === "string" && /^\d+(?::\d+)?@(lid|s\.whatsapp\.net|c\.us)$/i.test(value.trim())) {
      return value.trim().replace(/:\d+(?=@)/, "");
    }
  }
  return null;
}
