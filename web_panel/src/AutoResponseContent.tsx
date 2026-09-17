import { useState } from "react";
import { Eye, Image, Paperclip, Plus, Trash2 } from "lucide-react";
import { api, absoluteMediaUrl, type JsonRecord } from "./api";

const record = (value: unknown): JsonRecord => value && typeof value === "object" ? value as JsonRecord : {};
const mediaTypes = { image: "Imagem", video: "Vídeo", audio: "Áudio", document: "Documento", sticker: "Figurinha" };

export function AutoResponseContent({ groupId, source, text, disabled, onChange, onBusy }: {
  groupId: number; source: JsonRecord; text: string; disabled: boolean;
  onChange: (patch: JsonRecord) => void; onBusy: (busy: boolean) => void;
}) {
  const media = record(source.responseMedia);
  const template = record(source.responseButtons);
  const buttons = Array.isArray(template.buttons) ? template.buttons.map(record) : [];
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [kind, setKind] = useState(String(media.mediaType || "image"));
  const busy = uploading || disabled;
  const updateTemplate = (patch: JsonRecord) => onChange({ responseButtons: { ...template, ...patch } });
  const updateButton = (index: number, patch: JsonRecord) => updateTemplate({ buttons: buttons.map((button, i) => i === index ? { ...button, ...patch } : button) });
  const url = absoluteMediaUrl(media.url || media.path);
  const upload = async (file?: File) => {
    if (!file || busy) return;
    if (file.size > 16 * 1024 * 1024) { setError("Selecione um arquivo de até 16 MB."); return; }
    setUploading(true); onBusy(true); setError("");
    try {
      const result = await api.uploadAutoResponseMedia(groupId, file, kind);
      onChange({ responseMedia: { ...result.media, mediaType: kind, caption: null } });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível enviar a mídia."); }
    finally { setUploading(false); onBusy(false); }
  };
  return <div className="response-content-editor">
    <fieldset disabled={busy} className="response-content-section">
      <legend>Mídia <span>opcional</span></legend>
      <div className="response-media-controls">
        <label className="quick-label">Tipo de arquivo<select value={kind} onChange={event => setKind(event.target.value)}>{Object.entries(mediaTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="secondary-button file-action-button"><Paperclip />{uploading ? "Enviando…" : url ? "Trocar mídia" : "Adicionar mídia"}<input aria-label="Enviar mídia da resposta" type="file" accept={kind === "document" ? undefined : kind === "sticker" ? "image/*,video/*" : `${kind}/*`} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void upload(file); }} /></label>
      </div>
      {url && <div className="response-attachment"><span><Image />{String(media.fileName || "Mídia anexada")}</span><button type="button" className="icon-button" aria-label="Remover mídia da resposta" onClick={() => onChange({ responseMedia: null })}><Trash2 /></button></div>}
      {url && <small>A mídia salva permanece ativa até você salvar as alterações.</small>}
    </fieldset>
    <fieldset disabled={busy} className="response-content-section">
      <legend>Botões <span>opcional</span></legend>
      <label className="settings-toggle compact-config-toggle"><span><b>Adicionar botões</b></span><input type="checkbox" checked={Boolean(source.responseButtons)} onChange={event => onChange({ responseButtons: event.target.checked ? { type: "button_reply", buttons: [{ id: crypto.randomUUID(), text: "" }], footer: "" } : null })} /><i /></label>
      {Boolean(source.responseButtons) && <>
        <label className="quick-label">Formato<select value={String(template.type || "button_reply")} onChange={event => updateTemplate({ type: event.target.value, buttons: buttons.map(button => ({ ...button, type: event.target.value === "button_cta" ? button.type || "cta_url" : undefined })) })}><option value="button_reply">Respostas rápidas</option><option value="button_cta">Link, telefone ou copiar</option></select></label>
        {buttons.map((button, index) => <div className="response-button-editor" key={String(button.id || index)}>
          <div className="response-attachment"><b>Botão {index + 1}</b><button type="button" className="icon-button" aria-label={`Remover botão ${index + 1}`} onClick={() => updateTemplate({ buttons: buttons.filter((_, i) => i !== index) })}><Trash2 /></button></div>
          <label className="quick-label">Texto do botão<input maxLength={20} value={String(button.text || "")} onChange={event => updateButton(index, { text: event.target.value })} placeholder="Ex.: Ver catálogo" /></label>
          {template.type === "button_cta" ? <>
            <label className="quick-label">Ação<select value={String(button.type || "cta_url")} onChange={event => updateButton(index, { type: event.target.value })}><option value="cta_url">Abrir link</option><option value="cta_call">Ligar</option><option value="cta_copy">Copiar texto</option></select></label>
            <label className="quick-label">{button.type === "cta_call" ? "Telefone com DDI" : button.type === "cta_copy" ? "Texto para copiar" : "Endereço do link"}<input value={String(button.type === "cta_call" ? button.phoneNumber || "" : button.type === "cta_copy" ? button.copyCode || "" : button.url || "")} placeholder={button.type === "cta_call" ? "+5511999999999" : button.type === "cta_copy" ? "Código ou texto" : "https://..."} onChange={event => updateButton(index, { [button.type === "cta_call" ? "phoneNumber" : button.type === "cta_copy" ? "copyCode" : "url"]: event.target.value, ...(button.type === "cta_url" ? { urlSource: "manual" } : {}) })} /></label>
          </> : <label className="quick-label">Identificador / comando<input value={String(button.id || "")} onChange={event => updateButton(index, { id: event.target.value })} placeholder="Ex.: !menu" /></label>}
        </div>)}
        <button type="button" className="secondary-button" disabled={buttons.length >= 3} onClick={() => updateTemplate({ buttons: [...buttons, { id: crypto.randomUUID(), text: "", ...(template.type === "button_cta" ? { type: "cta_url" } : {}) }] })}><Plus />Adicionar botão ({buttons.length}/3)</button>
        <label className="quick-label">Título opcional<input maxLength={60} value={String(template.title || "")} onChange={event => updateTemplate({ title: event.target.value })} /></label>
        {Boolean(template.body) && <label className="quick-label">Texto específico dos botões<textarea maxLength={1024} value={String(template.body)} onChange={event => updateTemplate({ body: event.target.value })} /></label>}
        <label className="quick-label">Rodapé opcional<input maxLength={60} value={String(template.footer || "")} placeholder="Escolha uma opção abaixo 👇" onChange={event => updateTemplate({ footer: event.target.value })} /></label>
      </>}
    </fieldset>
    {Boolean(source.responseVcard) && <small>O contato já cadastrado será mantido.</small>}
    {error && <div className="form-error" role="alert">{error}</div>}
    <details className="response-preview"><summary><Eye />Ver prévia da resposta</summary><div className="response-preview-bubble"><b>BotAdmin</b>
      {url && (media.mediaType === "image" || media.mediaType === "sticker" ? <img className="response-media-preview" src={url} alt="Mídia da resposta" /> : media.mediaType === "video" ? <video className="response-media-preview" src={url} controls preload="metadata" /> : media.mediaType === "audio" ? <audio src={url} controls preload="metadata" /> : <span className="response-attachment"><Paperclip />{String(media.fileName || "Documento")}</span>)}
      {Boolean(template.title) && <strong>{String(template.title)}</strong>}
      <p>{String(template.body || text || (buttons.length ? "Selecione uma opção abaixo." : ""))}</p>
      {Boolean(template.footer) && <small>{String(template.footer)}</small>}
      {buttons.map((button, index) => <div className="response-preview-option" key={index}>{button.type === "cta_url" ? "↗ " : button.type === "cta_call" ? "☎ " : button.type === "cta_copy" ? "⧉ " : "↩ "}{String(button.text || `Botão ${index + 1}`)}</div>)}
    </div></details>
  </div>;
}
