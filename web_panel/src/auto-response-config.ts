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
    const buttonsConfig = entry.source.responseButtons;
    if (buttonsConfig && typeof buttonsConfig === "object") {
      const buttons = (buttonsConfig as { buttons?: unknown }).buttons;
      if (!Array.isArray(buttons) || buttons.length === 0) {
        throw new Error(`Adicione ao menos um botão na resposta ${index + 1} ou desative os botões.`);
      }
      if (buttons.some((button) => !button || typeof button !== "object" || !String((button as { text?: unknown }).text || "").trim())) {
        throw new Error(`Informe o texto de todos os botões da resposta ${index + 1}.`);
      }
      if ((buttonsConfig as { type?: unknown }).type === "button_cta") {
        const invalidAction = buttons.some((button) => {
          if (!button || typeof button !== "object") return true;
          const item = button as { type?: unknown; url?: unknown; phoneNumber?: unknown; copyCode?: unknown };
          if (item.type === "cta_url") return !String(item.url || "").trim();
          if (item.type === "cta_call") return !String(item.phoneNumber || "").trim();
          if (item.type === "cta_copy") return !String(item.copyCode || "").trim();
          return true;
        });
        if (invalidAction) throw new Error(`Complete a ação de todos os botões CTA da resposta ${index + 1}.`);
      }
    }
    return { ...entry.source, id: entry.id, triggers, responseText, matchMode: entry.matchMode, updatedAt: new Date().toISOString() };
  });
  return { autoResponses, commandToggles: { autoresposta: enabled } };
}
