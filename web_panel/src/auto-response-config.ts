export type AutoResponseDraft = {
  id: string;
  source: Record<string, unknown>;
  triggers: string;
  responseText: string;
  matchMode: "contains" | "equals";
};

/** Keep legacy media, contacts, buttons and matching policies when editing text. */
export function buildAutoResponsePatch(drafts: AutoResponseDraft[], enabled: boolean) {
  if (drafts.length > 50) throw new Error("O grupo pode ter até 50 respostas automáticas.");
  const autoResponses = drafts.map((entry, index) => {
    const triggers = [...new Set(entry.triggers.split(/[\n,;]+/).map(value => value.trim().toLowerCase()).filter(Boolean))];
    if (!triggers.length && !entry.source.matchAnyMessage) {
      throw new Error(`Informe ao menos um gatilho na resposta ${index + 1}.`);
    }
    if (triggers.length > 20) throw new Error(`Use até 20 gatilhos na resposta ${index + 1}.`);
    const responseText = entry.responseText.trim();
    if (!responseText && !entry.source.responseMedia && !entry.source.responseVcard && !entry.source.responseButtons) {
      throw new Error(`Informe o texto ou mantenha uma mídia, contato ou botão na resposta ${index + 1}.`);
    }
    return { ...entry.source, id: entry.id, triggers, responseText, matchMode: entry.matchMode, updatedAt: new Date().toISOString() };
  });
  return { autoResponses, commandToggles: { autoresposta: enabled } };
}
