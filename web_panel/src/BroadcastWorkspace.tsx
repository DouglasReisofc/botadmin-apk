import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Bookmark,
  CheckSquare,
  Copy,
  ExternalLink,
  Image,
  MoreVertical,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  RadioTower,
  RefreshCw,
  Reply,
  Send,
  Trash2,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import { absoluteMediaUrl, api, type JsonRecord } from "./api";
import InfoTip from "./InfoTip";

const listOf = (value: unknown, keys: string[] = []) => {
  if (Array.isArray(value)) return value as JsonRecord[];
  if (!value || typeof value !== "object") return [];
  const record = value as JsonRecord;
  for (const key of keys)
    if (Array.isArray(record[key])) return record[key] as JsonRecord[];
  return [];
};
const textOf = (value: unknown, fallback = "") =>
  value === null || value === undefined ? fallback : String(value);
const dateOf = (value: unknown) => {
  if (!value) return "";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};
const clockOf = (value: unknown, fallback: string) => {
  if (typeof value === "string" && /^\d{1,2}:\d{2}$/.test(value.trim()))
    return value.trim().padStart(5, "0");
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return fallback;
  const bounded = Math.max(0, Math.min(1439, Math.floor(minutes)));
  return `${String(Math.floor(bounded / 60)).padStart(2, "0")}:${String(bounded % 60).padStart(2, "0")}`;
};
const mediaFrom = (item: JsonRecord) => {
  const payload = (
    item.payload && typeof item.payload === "object" ? item.payload : {}
  ) as JsonRecord;
  const media = (
    item.media && typeof item.media === "object" ? item.media : payload.media
  ) as JsonRecord | undefined;
  return media || null;
};
const payloadFrom = (item: JsonRecord | null | undefined) =>
  item?.payload && typeof item.payload === "object"
    ? (item.payload as JsonRecord)
    : {};

function BroadcastActionMenu({
  items,
  label,
}: {
  items: Array<{
    id: string;
    label: string;
    danger?: boolean;
    onClick: () => void;
  }>;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="broadcast-action-menu">
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreVertical />
      </button>
      {open && (
        <div
          className="broadcast-action-popover"
          role="menu"
          onMouseLeave={() => setOpen(false)}
        >
          {items.map((item) => (
            <button
              type="button"
              role="menuitem"
              className={item.danger ? "danger" : ""}
              key={item.id}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BroadcastCountdown({ value }: { value: unknown }) {
  const target = new Date(String(value || "")).getTime();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!Number.isFinite(target)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [target]);
  if (!Number.isFinite(target)) return null;
  const seconds = Math.max(0, Math.ceil((target - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return (
    <small className="broadcast-live-countdown">
      {seconds > 0
        ? `Próximo envio em ${hours ? `${hours}:` : ""}${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
        : "Preparando próximo envio…"}
    </small>
  );
}

type Props = { selectedInstance: number | null };

function BroadcastPreviewCard({
  body,
  media,
  buttons,
}: {
  body: string;
  media: JsonRecord | null;
  buttons: BroadcastButton[];
}) {
  const url = media
    ? absoluteMediaUrl(
        textOf(media.url || media.mediaUrl || media.path || media.proxyUrl),
      )
    : "";
  const kind = textOf(media?.mimeType || media?.mediaType || media?.type);
  const buttonIcon = (type: BroadcastButton["type"]) =>
    type === "cta_url" ? (
      <ExternalLink />
    ) : type === "cta_copy" ? (
      <Copy />
    ) : type === "cta_call" ? (
      <Phone />
    ) : (
      <Reply />
    );
  return (
    <div className="broadcast-preview-area">
      <div className="broadcast-preview-label">Prévia da mensagem</div>
      <article className="broadcast-preview-card">
        <b>BotAdmin</b>
        {media &&
          (kind.includes("video") ? (
            <video controls src={url} />
          ) : kind.includes("audio") ? (
            <audio controls src={url} />
          ) : kind.includes("pdf") || kind.includes("document") ? (
            <a
              className="broadcast-document-preview"
              href={url}
              target="_blank"
              rel="noreferrer"
            >
              📄 {textOf(media.fileName || media.name, "Documento")}
            </a>
          ) : (
            <img src={url} alt="Prévia da mídia" />
          ))}
        <p>{body.trim() || "Mensagem somente com mídia ou botões"}</p>
        {buttons.map((button) => (
          <button type="button" key={button.id}>
            {buttonIcon(button.type)}
            {button.text || "Opção"}
          </button>
        ))}
        <small>pronta para enviar · 11:14 ✓✓</small>
      </article>
    </div>
  );
}

function CreateListModal({
  onClose,
  onSubmit,
  busy,
}: {
  onClose: () => void;
  onSubmit: (
    name: string,
    description: string,
    contacts: JsonRecord[],
    googleSheetUrl: string,
  ) => void;
  busy: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [manual, setManual] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const contacts = manual
    .split(/[\n,;]+/)
    .map((line) => {
      const parts = line.trim().split(/\s*[|:]\s*/);
      const phone =
        (parts.length > 1 ? parts.pop() : parts[0])?.replace(/\D/g, "") || "";
      return {
        name: parts.length > 1 ? parts.join(" ") : "",
        phone,
        source: "manual",
      };
    })
    .filter((item) => item.phone);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className="broadcast-editor-modal broadcast-create-modal"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim())
            onSubmit(
              name.trim(),
              description.trim(),
              contacts,
              sheetUrl.trim(),
            );
        }}
      >
        <header>
          <div>
            <div className="modal-heading-line">
              <h2>Nova lista de transmissão</h2>
              <InfoTip label="Nova lista de transmissão">
                Crie uma lista reutilizável e adicione destinatários agora ou depois.
              </InfoTip>
            </div>
            <p>Organize destinatários e reutilize suas mensagens.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            <X />
          </button>
        </header>
        <label>
          Nome da lista
          <input
            autoFocus
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: Clientes e leads"
          />
        </label>
        <label>
          Descrição <span>(opcional)</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            placeholder="Para que esta lista será usada?"
          />
        </label>
        <label>
          Destinatários iniciais <span>(opcional)</span>
          <textarea
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            rows={4}
            placeholder={"Um número por linha ou Nome | 5592999999999"}
          />
        </label>
        <label>
          Google Sheets <span>(opcional)</span>
          <input
            type="url"
            value={sheetUrl}
            onChange={(event) => setSheetUrl(event.target.value)}
            placeholder="https://docs.google.com/spreadsheets/…"
          />
        </label>
        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={busy || !name.trim()}
            onClick={() =>
              onSubmit(
                name.trim(),
                description.trim(),
                contacts,
                sheetUrl.trim(),
              )
            }
          >
            {busy
              ? "Criando…"
              : `Criar lista${contacts.length ? ` com ${contacts.length}` : ""}`}
          </button>
        </footer>
      </form>
    </div>
  );
}

function SavedMessagesModal({
  templates,
  selectedId,
  busy,
  onClose,
  onSelect,
  onEdit,
  onCreate,
  onDelete,
}: {
  templates: JsonRecord[];
  selectedId?: string | null;
  busy: boolean;
  onClose: () => void;
  onSelect: (template: JsonRecord) => void;
  onEdit: (template: JsonRecord) => void;
  onCreate: () => void;
  onDelete: (templateId: string) => void;
}) {
  const summary = (template: JsonRecord) => {
    const payload =
      template.payload && typeof template.payload === "object"
        ? (template.payload as JsonRecord)
        : {};
    const parts = [] as string[];
    if (mediaFrom(template))
      parts.push(textOf((mediaFrom(template) || {}).mediaType, "Mídia"));
    if (textOf(template.body).trim()) parts.push("Texto");
    const buttonCount = listOf(payload, ["buttons"]).length;
    if (buttonCount)
      parts.push(`${buttonCount} ${buttonCount === 1 ? "botão" : "botões"}`);
    const variantCount = listOf(payload, ["messageVariants"]).length;
    if (variantCount >= 2) parts.push(`${variantCount} variações internas`);
    return parts.join(" · ") || "Mensagem pronta";
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="broadcast-editor-modal broadcast-saved-modal"
        role="dialog"
        aria-modal="true"
      >
        <header>
          <div>
            <div className="modal-heading-line">
              <h2>
                <Bookmark /> Mensagens salvas
              </h2>
              <InfoTip label="Mensagens salvas">
                Selecione um modelo existente ou abra o editor para criar uma nova mensagem.
              </InfoTip>
            </div>
            <p>Selecione uma mensagem ou abra o editor pelo lápis.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            <X />
          </button>
        </header>
        <div className="broadcast-saved-list">
          {templates.length ? (
            templates.map((template, index) => {
              const id = textOf(template.id);
              const selected = Boolean(id && id === selectedId);
              return (
                <article
                  className={selected ? "selected" : ""}
                  key={id || index}
                >
                  <button
                    type="button"
                    className="broadcast-saved-select"
                    onClick={() => onSelect(template)}
                  >
                    <span>
                      <Bookmark />
                    </span>
                    <div>
                      <b>{textOf(template.name, `Mensagem ${index + 1}`)}</b>
                      <small>{summary(template)}</small>
                      <p>
                        {textOf(
                          template.body,
                          "Mensagem somente com mídia ou botões",
                        )}
                      </p>
                    </div>
                    {selected && <em>Selecionada</em>}
                  </button>
                  <button
                    type="button"
                    title="Editar no preview"
                    aria-label={`Editar ${textOf(template.name)}`}
                    onClick={() => onEdit(template)}
                  >
                    <Pencil />
                  </button>
                  <button
                    type="button"
                    title="Excluir mensagem"
                    aria-label={`Excluir ${textOf(template.name)}`}
                    disabled={busy || !id}
                    onClick={() => onDelete(id)}
                  >
                    <Trash2 />
                  </button>
                </article>
              );
            })
          ) : (
            <div className="broadcast-saved-empty">
              <Bookmark />
              <b>Nenhuma mensagem salva</b>
              <p>Crie o primeiro modelo para reutilizar nesta lista.</p>
            </div>
          )}
        </div>
        <footer>
          <button type="button" className="primary-button" onClick={onCreate}>
            <Plus /> Criar nova mensagem
          </button>
        </footer>
      </section>
    </div>
  );
}

type BroadcastButton = {
  id: string;
  text: string;
  type: "quick_reply" | "cta_url" | "cta_copy" | "cta_call";
  url?: string;
  copyCode?: string;
  phoneNumber?: string;
};
type BroadcastVariantDraft = {
  name: string;
  body: string;
  media: JsonRecord | null;
  buttons: BroadcastButton[];
  variables: JsonRecord[];
};

const buttonsFromValue = (value: unknown): BroadcastButton[] =>
  listOf(value).map((item, index) => ({
    id: textOf(item.id, `broadcast_${index + 1}`),
    text: textOf(item.text || item.title || item.label),
    type: textOf(item.type, "quick_reply") as BroadcastButton["type"],
    ...(item.url ? { url: textOf(item.url) } : {}),
    ...(item.copyCode ? { copyCode: textOf(item.copyCode) } : {}),
    ...(item.phoneNumber ? { phoneNumber: textOf(item.phoneNumber) } : {}),
  }));

function BroadcastButtonsModal({
  initial,
  onClose,
  onApply,
}: {
  initial: BroadcastButton[];
  onClose: () => void;
  onApply: (buttons: BroadcastButton[]) => void;
}) {
  const [items, setItems] = useState<BroadcastButton[]>(
    initial.length
      ? initial
      : [{ id: "broadcast_1", text: "", type: "quick_reply" }],
  );
  const update = (index: number, patch: Partial<BroadcastButton>) =>
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="broadcast-editor-modal broadcast-submodal"
        role="dialog"
        aria-modal="true"
      >
        <header>
          <div>
            <div className="modal-heading-line">
              <h2>Editor de botões</h2>
              <InfoTip label="Botões interativos">
                Os botões são exibidos no rodapé da mensagem. Você pode usar resposta, link, cópia ou ligação.
              </InfoTip>
            </div>
            <p>
              Até 3 botões. Eles aparecem no rodapé do balão, como no WhatsApp.
            </p>
          </div>
          <button onClick={onClose} aria-label="Fechar">
            <X />
          </button>
        </header>
        <div className="broadcast-submodal-scroll">
          {items.map((item, index) => (
            <div className="broadcast-button-draft" key={item.id}>
              <div className="broadcast-button-draft-heading">
                <b>Botão {index + 1}</b>
                <button
                  type="button"
                  onClick={() =>
                    setItems((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  aria-label="Remover botão"
                >
                  <X />
                </button>
              </div>
              <label>
                Texto exibido
                <input
                  value={item.text}
                  onChange={(event) =>
                    update(index, { text: event.target.value })
                  }
                  placeholder="Ex.: Abrir site"
                />
              </label>
              <label>
                Ação
                <select
                  value={item.type}
                  onChange={(event) =>
                    update(index, {
                      type: event.target.value as BroadcastButton["type"],
                      url: undefined,
                      copyCode: undefined,
                      phoneNumber: undefined,
                    })
                  }
                >
                  <option value="quick_reply">Resposta rápida</option>
                  <option value="cta_url">Abrir link</option>
                  <option value="cta_copy">Copiar código</option>
                  <option value="cta_call">Ligar para número</option>
                </select>
              </label>
              {item.type === "cta_url" && (
                <label>
                  Endereço do link
                  <input
                    type="url"
                    value={item.url || ""}
                    onChange={(event) =>
                      update(index, { url: event.target.value })
                    }
                    placeholder="https://…"
                  />
                </label>
              )}
              {item.type === "cta_copy" && (
                <label>
                  Código para copiar
                  <input
                    value={item.copyCode || ""}
                    onChange={(event) =>
                      update(index, { copyCode: event.target.value })
                    }
                    placeholder="Código ou chave"
                  />
                </label>
              )}
              {item.type === "cta_call" && (
                <label>
                  Número para ligar
                  <input
                    type="tel"
                    value={item.phoneNumber || ""}
                    onChange={(event) =>
                      update(index, { phoneNumber: event.target.value })
                    }
                    placeholder="5592999999999"
                  />
                </label>
              )}
            </div>
          ))}
          {items.length < 3 && (
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                setItems((current) => [
                  ...current,
                  {
                    id: `broadcast_${current.length + 1}_${Date.now()}`,
                    text: "",
                    type: "quick_reply",
                  },
                ])
              }
            >
              <Plus /> Adicionar botão
            </button>
          )}
        </div>
        <footer>
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => onApply(items.filter((item) => item.text.trim()))}
          >
            Aplicar ao card
          </button>
        </footer>
      </section>
    </div>
  );
}

function BroadcastVariablesModal({
  initial,
  contacts,
  instanceId,
  listId,
  body,
  onClose,
  onApply,
}: {
  initial: JsonRecord[];
  contacts: JsonRecord[];
  instanceId: number;
  listId: string;
  body: string;
  onClose: () => void;
  onApply: (variables: JsonRecord[]) => void;
}) {
  const contactFields = Array.from(
    new Set([
      "nome",
      "pushName",
      "numero",
      "localizacao",
      "detalhes",
      ...contacts.flatMap((contact) => {
        const attrs = contact.attributes;
        return attrs && typeof attrs === "object"
          ? Object.keys(attrs as JsonRecord)
          : [];
      }),
    ]),
  ).sort();
  const [items, setItems] = useState<JsonRecord[]>(
    initial.length
      ? initial.map((item) => ({
          ...item,
          source: item.source || item.field || "nome",
          type: item.type === "text" ? "static" : item.type,
        }))
      : [{ name: "", type: "contact", source: "nome", fallback: "" }],
  );
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const [testing, setTesting] = useState(false);
  const update = (index: number, patch: JsonRecord) =>
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  const normalized = () => {
    const names = new Set<string>();
    const values: JsonRecord[] = items.map((item) => ({
      ...item,
      name: String(item.name || "").trim(),
    }));
    if (
      values.some(
        (item) =>
          !String(item.name || "") ||
          !/^[a-zA-Z0-9_]+$/.test(String(item.name || "")),
      )
    ) {
      setError("Use apenas letras, números e _ no nome das variáveis.");
      return null;
    }
    if (
      values.some((item) => {
        const name = String(item.name || "").toLowerCase();
        return names.has(name) || !names.add(name);
      })
    ) {
      setError("Existem variáveis com o mesmo nome.");
      return null;
    }
    if (
      values.some(
        (item) => item.type === "api" && !String(item.apiUrl || "").trim(),
      )
    ) {
      setError("Informe a URL da variável de API.");
      return null;
    }
    setError("");
    return values;
  };
  const test = async () => {
    const values = normalized();
    if (!values || testing) return;
    setTesting(true);
    setPreview("");
    try {
      const result = await api.previewBroadcastVariables(instanceId, listId, {
        body,
        variables: values,
      });
      const contact =
        result.contact && typeof result.contact === "object"
          ? (result.contact as JsonRecord)
          : {};
      setPreview(
        `Prévia para ${textOf(contact.name, "o primeiro destinatário")}:\n${textOf(result.rendered)}`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível testar as variáveis.",
      );
    } finally {
      setTesting(false);
    }
  };
  const apply = () => {
    const values = normalized();
    if (values) onApply(values);
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="broadcast-editor-modal broadcast-submodal"
        role="dialog"
        aria-modal="true"
      >
        <header>
          <div>
            <div className="modal-heading-line">
              <h2>Variáveis inteligentes</h2>
              <InfoTip label="Variáveis inteligentes">
                Use variáveis como {"{{nome}}"} para personalizar a mensagem de cada destinatário.
              </InfoTip>
            </div>
            <p>
              Use <code>{"{{nome}}"}</code> no texto ou na URL de uma API para
              personalizar cada destinatário.
            </p>
          </div>
          <button onClick={onClose} aria-label="Fechar">
            <X />
          </button>
        </header>
        {error && <div className="broadcast-inline-error">{error}</div>}
        <div className="broadcast-submodal-scroll">
          {items.map((item, index) => (
            <div className="broadcast-button-draft" key={index}>
              <div className="broadcast-button-draft-heading">
                <b>Variável {index + 1}</b>
                <button
                  type="button"
                  onClick={() =>
                    setItems((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  aria-label="Remover variável"
                >
                  <X />
                </button>
              </div>
              <label>
                Nome
                <input
                  value={String(item.name || "")}
                  onChange={(event) =>
                    update(index, {
                      name: event.target.value.replace(/[^a-zA-Z0-9_]/g, "_"),
                    })
                  }
                  placeholder="Ex.: nome"
                />
              </label>
              <label>
                Origem
                <select
                  value={String(item.type || "contact")}
                  onChange={(event) =>
                    update(index, { type: event.target.value })
                  }
                >
                  <option value="contact">Campo do contato/planilha</option>
                  <option value="static">Texto fixo</option>
                  <option value="greeting">Saudação por horário</option>
                  <option value="datetime">Data e hora</option>
                  <option value="api">API JSON</option>
                </select>
              </label>
              {item.type === "contact" && (
                <label>
                  Campo
                  <select
                    value={String(item.source || "nome")}
                    onChange={(event) =>
                      update(index, { source: event.target.value })
                    }
                  >
                    {contactFields.map((field) => (
                      <option key={field} value={field}>
                        {field}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {item.type === "api" && (
                <>
                  <label>
                    URL HTTP/HTTPS
                    <input
                      type="url"
                      value={String(item.apiUrl || "")}
                      onChange={(event) =>
                        update(index, { apiUrl: event.target.value })
                      }
                      placeholder="https://api.exemplo.com/clientes/{{numero}}"
                    />
                  </label>
                  <label>
                    Caminho JSON <span>(opcional)</span>
                    <input
                      value={String(item.jsonPath || "")}
                      onChange={(event) =>
                        update(index, { jsonPath: event.target.value })
                      }
                      placeholder="data.cliente.nome"
                    />
                  </label>
                </>
              )}
              {item.type === "static" && (
                <label>
                  Valor fixo
                  <input
                    value={String(item.value || "")}
                    onChange={(event) =>
                      update(index, { value: event.target.value })
                    }
                  />
                </label>
              )}
              {item.type === "greeting" && (
                <div className="broadcast-variable-grid">
                  <label>
                    Bom dia
                    <input
                      value={String(item.morningText || "Bom dia")}
                      onChange={(event) =>
                        update(index, { morningText: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Boa tarde
                    <input
                      value={String(item.afternoonText || "Boa tarde")}
                      onChange={(event) =>
                        update(index, { afternoonText: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Boa noite
                    <input
                      value={String(item.eveningText || "Boa noite")}
                      onChange={(event) =>
                        update(index, { eveningText: event.target.value })
                      }
                    />
                  </label>
                </div>
              )}
              {item.type === "datetime" && (
                <div className="broadcast-variable-grid">
                  <label>
                    Formato
                    <select
                      value={String(item.format || "datetime")}
                      onChange={(event) =>
                        update(index, { format: event.target.value })
                      }
                    >
                      <option value="date">Somente data</option>
                      <option value="time">Somente hora</option>
                      <option value="datetime">Data e hora</option>
                    </select>
                  </label>
                  <label>
                    Fuso horário
                    <input
                      value={String(item.timezone || "America/Sao_Paulo")}
                      onChange={(event) =>
                        update(index, { timezone: event.target.value })
                      }
                      placeholder="America/Sao_Paulo"
                    />
                  </label>
                </div>
              )}
              <label>
                Fallback
                <input
                  value={String(item.fallback || "")}
                  onChange={(event) =>
                    update(index, { fallback: event.target.value })
                  }
                  placeholder="Usado se não houver valor"
                />
              </label>
            </div>
          ))}
          <div className="broadcast-variable-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                setItems((current) => [
                  ...current,
                  { name: "", type: "contact", source: "nome", fallback: "" },
                ])
              }
            >
              <Plus /> Nova variável
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void test()}
              disabled={testing || !contacts.length}
            >
              {testing
                ? "Consultando…"
                : "▶ Testar com o primeiro destinatário"}
            </button>
          </div>
          {preview && (
            <pre className="broadcast-variable-preview">{preview}</pre>
          )}
        </div>
        <footer>
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary-button" type="button" onClick={apply}>
            Aplicar variáveis
          </button>
        </footer>
      </section>
    </div>
  );
}

const parseImportedContacts = (raw: string): JsonRecord[] => {
  const source = raw.replace(/^\uFEFF/, "").trim();
  if (!source) return [];
  try {
    const parsed: unknown = JSON.parse(source);
    const rows: unknown[] = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as JsonRecord).contacts)
        ? ((parsed as JsonRecord).contacts as unknown[])
        : [];
    if (rows.length) {
      return rows
        .map((value) => {
          const item: JsonRecord =
            value && typeof value === "object"
              ? (value as JsonRecord)
              : { phone: value };
          const phone = textOf(
            item.phone ||
              item.whatsapp ||
              item.numero ||
              item.number ||
              item.jid,
          ).replace(/\D/g, "");
          return {
            ...item,
            name: textOf(item.name || item.nome || item.pushName),
            phone,
            source: "import",
          };
        })
        .filter((item) => String(item.phone).length >= 8);
    }
  } catch {
    // A CSV/text import is handled below.
  }
  const lines = source.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const delimiter = lines[0].includes(";")
    ? ";"
    : lines[0].includes(",")
      ? ","
      : "|";
  const cells = (line: string) =>
    line
      .split(delimiter)
      .map((cell) => cell.trim().replace(/^['"]|['"]$/g, ""));
  const first = cells(lines[0]);
  const hasHeader = first.some((cell) =>
    /^(nome|name|telefone|phone|whatsapp|numero|number)$/i.test(cell),
  );
  const headers = hasHeader ? first.map((cell) => cell.toLowerCase()) : [];
  const phoneIndex = hasHeader
    ? Math.max(
        0,
        headers.findIndex((cell) =>
          /telefone|phone|whatsapp|numero|number/.test(cell),
        ),
      )
    : 0;
  const nameIndex = hasHeader
    ? headers.findIndex((cell) => /nome|name/.test(cell))
    : 1;
  return lines
    .slice(hasHeader ? 1 : 0)
    .map((line) => {
      const values = cells(line);
      const inferredPhoneIndex = hasHeader
        ? phoneIndex
        : Math.max(
            0,
            values.findIndex((value) => value.replace(/\D/g, "").length >= 8),
          );
      const inferredNameIndex = hasHeader
        ? nameIndex
        : values.findIndex((_, index) => index !== inferredPhoneIndex);
      const phone = textOf(values[inferredPhoneIndex]).replace(/\D/g, "");
      return {
        name: inferredNameIndex >= 0 ? textOf(values[inferredNameIndex]) : "",
        phone,
        source: "import",
      };
    })
    .filter((item) => item.phone.length >= 8);
};

function BroadcastGroupDiscoveryModal({
  instanceId,
  onClose,
  onChanged,
  onError,
}: {
  instanceId: number;
  onClose: () => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("divulgacao");
  const [categories, setCategories] = useState<JsonRecord[]>([
    { name: "Divulgação", slug: "divulgacao" },
    { name: "Amizade", slug: "amizade" },
    { name: "Compra e venda", slug: "compra-e-venda" },
    { name: "Esportes", slug: "esportes" },
    { name: "Tecnologia", slug: "tecnologia" },
  ]);
  const [groups, setGroups] = useState<JsonRecord[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [joining, setJoining] = useState(false);
  const initialSearchDone = useRef(false);
  const search = useCallback(async () => {
    if (!query.trim() && !category.trim()) return;
    setLoading(true);
    try {
      const result = await api.discoverPublicGroups(query, category);
      const found = listOf(result, ["groups", "items"]);
      const returnedCategories = listOf(result, ["categories"]);
      if (returnedCategories.length) setCategories(returnedCategories);
      setGroups(found);
      setSelected(new Set());
    } catch (cause) {
      onError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível procurar grupos.",
      );
    } finally {
      setLoading(false);
    }
  }, [category, onError, query]);
  const keyOf = (item: JsonRecord) =>
    textOf(item.id || item.remoteId || item.jid || item.inviteLink);
  const joinSelected = async () => {
    const values = groups.filter((item) => selected.has(keyOf(item)));
    if (!values.length) return;
    setJoining(true);
    try {
      for (const item of values) {
        const invite = textOf(item.inviteLink || item.invite || item.url);
        if (invite) await api.joinPublicGroup(instanceId, invite);
      }
      onChanged();
      onClose();
    } catch (cause) {
      onError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível entrar nos grupos selecionados.",
      );
    } finally {
      setJoining(false);
    }
  };
  useEffect(() => {
    if (initialSearchDone.current) return;
    initialSearchDone.current = true;
    void search();
  }, [search]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="broadcast-editor-modal broadcast-submodal broadcast-discovery-modal"
        role="dialog"
        aria-modal="true"
      >
        <header>
          <div>
            <div className="modal-heading-line">
              <h2>Procurar grupos</h2>
              <InfoTip label="Procurar grupos">
                Filtre por categoria, confira os convites disponíveis e selecione somente os grupos desejados.
              </InfoTip>
            </div>
            <p>
              Escolha uma categoria, confira os grupos e entre pelo endpoint
              seguro da API.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            <X />
          </button>
        </header>
        <div className="broadcast-discovery-search">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nome ou palavra-chave (opcional)"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void search();
              }
            }}
          />
          <select
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
            }}
          >
            <option value="">Todas as categorias</option>
            {categories.map((item, index) => (
              <option
                value={textOf(item.slug || item.id)}
                key={String(item.slug || item.id || index)}
              >
                {textOf(item.name || item.title, "Categoria")}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="primary-button"
            onClick={() => void search()}
            disabled={loading}
          >
            {loading ? "Buscando…" : "Buscar"}
          </button>
        </div>
        <div className="broadcast-contact-list broadcast-discovery-list">
          {groups.length ? (
            groups.map((item, index) => {
              const key = keyOf(item);
              const invite = textOf(item.inviteLink || item.invite || item.url);
              return (
                <label key={key || index}>
                  <input
                    type="checkbox"
                    checked={selected.has(key)}
                    onChange={() =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                    disabled={!invite}
                  />
                  <span>
                    <b>
                      {textOf(
                        item.name || item.subject || item.title,
                        "Grupo sem nome",
                      )}
                    </b>
                    <small>
                      {textOf(
                        item.description ||
                          item.category ||
                          "Convite disponível",
                      )}
                    </small>
                  </span>
                  <em>{invite ? "convite" : "sem convite"}</em>
                </label>
              );
            })
          ) : (
            <div className="list-state">
              {loading
                ? "Consultando catálogo…"
                : "Nenhum grupo encontrado nesta busca."}
            </div>
          )}
        </div>
        <footer>
          {selected.size > 0 && (
            <span>{selected.size} selecionado(s)</span>
          )}
          <span className="footer-spacer" />
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancelar
          </button>
          {selected.size > 0 && (
            <button
              type="button"
              className="primary-button"
              onClick={() => void joinSelected()}
              disabled={joining}
            >
              {joining ? "Entrando…" : "Entrar e adicionar"}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

function GoogleSheetMapperModal({
  initial,
  onClose,
  onApply,
  onError,
}: {
  initial: JsonRecord;
  onClose: () => void;
  onApply: (url: string, mapping: JsonRecord) => Promise<void>;
  onError: (message: string) => void;
}) {
  const mapping =
    initial.mapping && typeof initial.mapping === "object"
      ? (initial.mapping as JsonRecord)
      : {};
  const [connection, setConnection] = useState<JsonRecord | null>(null);
  const [files, setFiles] = useState<JsonRecord[]>([]);
  const [url, setUrl] = useState(textOf(initial.url));
  const [preview, setPreview] = useState<JsonRecord | null>(null);
  const [sheetId, setSheetId] = useState(textOf(mapping.sheetId));
  const [nameColumn, setNameColumn] = useState(textOf(mapping.nameColumn));
  const [phoneColumn, setPhoneColumn] = useState(textOf(mapping.phoneColumn));
  const [attributes, setAttributes] = useState<Set<string>>(
    new Set(listOf(mapping.attributeColumns).map((item) => textOf(item))),
  );
  const [busy, setBusy] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const headers = Array.isArray(preview?.headers)
    ? preview.headers.map((item) => textOf(item))
    : [];
  const sheets = listOf(preview, ["sheets"]);
  const loadConnection = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const status = await api.googleSheetsStatus();
      setConnection(status.connected || null);
      if (status.connected) {
        const result = await api.googleSpreadsheets();
        setFiles(listOf(result, ["files"]));
      }
    } catch (cause) {
      onError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível consultar o Google Sheets.",
      );
    } finally {
      setLoadingFiles(false);
    }
  }, [onError]);
  useEffect(() => {
    void loadConnection();
  }, [loadConnection]);
  const openSheet = async (nextUrl = url, nextSheet = sheetId) => {
    if (!nextUrl.trim()) return;
    setBusy(true);
    try {
      const result = await api.previewGoogleSheet(
        nextUrl.trim(),
        nextSheet ? { sheetId: nextSheet } : undefined,
      );
      const nextHeaders = Array.isArray(result.headers)
        ? result.headers.map((item) => textOf(item))
        : [];
      const guess = (terms: string[]) =>
        nextHeaders.find((header) =>
          terms.some((term) => header.toLowerCase().includes(term)),
        );
      setPreview(result);
      setSheetId(textOf(result.sheetId));
      setNameColumn((current) =>
        nextHeaders.includes(current)
          ? current
          : guess(["nome", "name", "cliente", "contato"]) ||
            nextHeaders[0] ||
            "",
      );
      setPhoneColumn((current) =>
        nextHeaders.includes(current)
          ? current
          : guess([
              "telefone",
              "phone",
              "celular",
              "whatsapp",
              "numero",
              "número",
            ]) ||
            nextHeaders[1] ||
            "",
      );
      setAttributes(
        (current) =>
          new Set([...current].filter((item) => nextHeaders.includes(item))),
      );
    } catch (cause) {
      onError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível abrir a planilha.",
      );
    } finally {
      setBusy(false);
    }
  };
  const validate = async () => {
    if (!url.trim() || !phoneColumn) return;
    setBusy(true);
    try {
      setPreview(
        await api.previewGoogleSheet(url.trim(), {
          sheetId,
          nameColumn,
          phoneColumn,
          attributeColumns: [...attributes],
        }),
      );
    } catch (cause) {
      onError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível validar o mapeamento.",
      );
    } finally {
      setBusy(false);
    }
  };
  const connect = async () => {
    setBusy(true);
    try {
      const result = await api.authorizeGoogleSheets(
        `${location.pathname}?section=broadcasts`,
      );
      if (!result.authorizationUrl)
        throw new Error("O Google não retornou o endereço de autorização.");
      location.assign(result.authorizationUrl);
    } catch (cause) {
      onError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível conectar o Google Sheets.",
      );
      setBusy(false);
    }
  };
  const disconnect = async () => {
    if (!window.confirm("Desconectar a conta Google Sheets deste usuário?"))
      return;
    setBusy(true);
    try {
      await api.disconnectGoogleSheets();
      setConnection(null);
      setFiles([]);
    } catch (cause) {
      onError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível desconectar o Google Sheets.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="broadcast-editor-modal broadcast-sheet-modal">
        <header>
          <div>
            <div className="modal-heading-line">
              <h2>Importar contatos da planilha</h2>
              <InfoTip label="Importar planilha">
                Conecte uma planilha, confira a prévia e escolha quais colunas serão usadas como contato.
              </InfoTip>
            </div>
            <p>
              Escolha a planilha, confira uma prévia e mapeie somente as colunas
              que serão usadas.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            <X />
          </button>
        </header>
        <div className="broadcast-sheet-scroll">
          <section className="broadcast-sheet-step">
            <b>
              <span>1</span> Conecte e escolha a planilha
            </b>
            {loadingFiles ? (
              <div className="list-state">
                <RefreshCw className="spin" /> Consultando Google…
              </div>
            ) : connection ? (
              <div className="broadcast-sheet-connection">
                <span>
                  <strong>Google Sheets conectado</strong>
                  <small>{textOf(connection.email, "Conta autorizada")}</small>
                </span>
                <button
                  type="button"
                  className="secondary-button danger"
                  onClick={() => void disconnect()}
                  disabled={busy}
                >
                  Desconectar
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="primary-button"
                onClick={() => void connect()}
                disabled={busy}
              >
                Conectar minha conta Google Sheets
              </button>
            )}
            {connection && (
              <>
                <label>
                  Minhas planilhas
                  <select
                    value=""
                    onChange={(event) => {
                      const file = files.find(
                        (item) => textOf(item.id) === event.target.value,
                      );
                      if (!file) return;
                      const nextUrl = textOf(
                        file.url,
                        `https://docs.google.com/spreadsheets/d/${textOf(file.id)}/edit`,
                      );
                      setUrl(nextUrl);
                      void openSheet(nextUrl, "");
                    }}
                  >
                    <option value="">Selecione uma planilha</option>
                    {files.map((file, index) => (
                      <option
                        key={textOf(file.id, String(index))}
                        value={textOf(file.id)}
                      >
                        {textOf(file.name, "Planilha")}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="broadcast-sheet-url">
                  <input
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/…"
                  />
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy || !url.trim()}
                    onClick={() => void openSheet()}
                  >
                    {busy ? "Abrindo…" : "Abrir"}
                  </button>
                </div>
              </>
            )}
          </section>
          <section
            className={`broadcast-sheet-step ${preview ? "" : "disabled"}`}
          >
            <b>
              <span>2</span> Confira a aba e os dados
            </b>
            {preview && (
              <>
                <label>
                  Aba da planilha
                  <select
                    value={sheetId}
                    onChange={(event) => {
                      setSheetId(event.target.value);
                      void openSheet(url, event.target.value);
                    }}
                  >
                    {sheets.map((item, index) => (
                      <option
                        value={textOf(item.id)}
                        key={textOf(item.id, String(index))}
                      >
                        {textOf(item.title, "Aba")}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="broadcast-sheet-table">
                  <table>
                    <thead>
                      <tr>
                        {headers.map((header) => (
                          <th key={header}>{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(Array.isArray(preview.sampleRows)
                        ? preview.sampleRows
                        : []
                      )
                        .slice(0, 3)
                        .map((row, index) => (
                          <tr key={index}>
                            {headers.map((_, cell) => (
                              <td key={cell}>
                                {Array.isArray(row) ? textOf(row[cell]) : ""}
                              </td>
                            ))}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
          <section
            className={`broadcast-sheet-step ${preview ? "" : "disabled"}`}
          >
            <b>
              <span>3</span> Mapeie cada contato
            </b>
            {preview && (
              <>
                <div className="broadcast-sheet-map">
                  <label>
                    Nome do contato
                    <select
                      value={nameColumn}
                      onChange={(event) => setNameColumn(event.target.value)}
                    >
                      <option value="">Sem nome</option>
                      {headers.map((header) => (
                        <option value={header} key={header}>
                          {header}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Telefone / WhatsApp *
                    <select
                      value={phoneColumn}
                      onChange={(event) => setPhoneColumn(event.target.value)}
                    >
                      <option value="">Selecionar coluna</option>
                      {headers.map((header) => (
                        <option value={header} key={header}>
                          {header}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p>
                  Dados extras para personalização, como{" "}
                  <code>{"{{cidade}}"}</code> ou <code>{"{{produto}}"}</code>:
                </p>
                <div className="broadcast-sheet-attributes">
                  {headers
                    .filter(
                      (header) =>
                        header !== nameColumn && header !== phoneColumn,
                    )
                    .map((header) => (
                      <button
                        type="button"
                        className={attributes.has(header) ? "selected" : ""}
                        key={header}
                        onClick={() =>
                          setAttributes((current) => {
                            const next = new Set(current);
                            if (next.has(header)) next.delete(header);
                            else next.add(header);
                            return next;
                          })
                        }
                      >
                        {header}
                      </button>
                    ))}
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void validate()}
                  disabled={busy || !phoneColumn}
                >
                  Validar mapeamento
                </button>
                <strong className="broadcast-sheet-estimate">
                  {Number(preview.estimatedContacts || 0)} contato(s) válido(s)
                  encontrado(s)
                </strong>
              </>
            )}
          </section>
        </div>
        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancelar
          </button>
          <span className="footer-spacer" />
          <button
            type="button"
            className="primary-button"
            disabled={busy || !preview || !phoneColumn}
            onClick={() =>
              void onApply(url.trim(), {
                sheetId,
                nameColumn: nameColumn || null,
                phoneColumn,
                attributeColumns: [...attributes],
                estimatedContacts: Number(preview?.estimatedContacts || 0),
              })
            }
          >
            Confirmar planilha
          </button>
        </footer>
      </section>
    </div>
  );
}

function BroadcastLabelsModal({
  instanceId,
  currentListId,
  lists,
  contacts,
  onClose,
  onChanged,
  onError,
}: {
  instanceId: number;
  currentListId: string;
  lists: JsonRecord[];
  contacts: JsonRecord[];
  onClose: () => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const recipients = contacts
    .filter((item) => textOf(item.recipientType, "contact") !== "group")
    .map((item) => ({
      name: textOf(item.name || item.pushName),
      phone: textOf(item.phone || item.jid).replace(/\D/g, ""),
      source: "instance_label",
    }))
    .filter((item) => item.phone);
  const apply = async () => {
    if (busy || (!selected.size && !newLabel.trim()) || !recipients.length)
      return;
    setBusy(true);
    try {
      for (const listId of selected)
        await api.broadcastContacts(instanceId, listId, {
          contacts: recipients,
        });
      if (newLabel.trim())
        await api.createBroadcastList(instanceId, {
          name: newLabel.trim(),
          description: "Etiqueta de contatos",
          contacts: recipients,
        });
      onChanged();
      onClose();
    } catch (cause) {
      onError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível organizar os contatos.",
      );
    } finally {
      setBusy(false);
    }
  };
  const availableLists = lists.filter(
    (item) => textOf(item.id) !== currentListId,
  );
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="broadcast-editor-modal broadcast-submodal broadcast-labels-modal">
        <header>
          <div>
            <div className="modal-heading-line">
              <h2>Organizar em etiquetas</h2>
              <InfoTip label="Organizar em etiquetas">
                Aplique listas aos contatos selecionados para facilitar filtros e futuras transmissões.
              </InfoTip>
            </div>
            <p>
              Adicione os contatos selecionados a outras listas ou crie uma nova
              etiqueta.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            <X />
          </button>
        </header>
        <div className="broadcast-contact-list">
          {availableLists.length ? (
            availableLists.map((item, index) => {
              const id = textOf(item.id);
              return (
                <label key={id || index}>
                  <input
                    type="checkbox"
                    checked={selected.has(id)}
                    onChange={() =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      })
                    }
                  />
                  <span>
                    <b>{textOf(item.name, "Lista")}</b>
                    <small>
                      {Number(item.contactCount || item.contactsCount || 0)}{" "}
                      destinatário(s)
                    </small>
                  </span>
                </label>
              );
            })
          ) : (
            <div className="list-state">
              Não há outra lista. Crie uma nova etiqueta abaixo.
            </div>
          )}
        </div>
        <label>
          Nova etiqueta <span>(opcional)</span>
          <input
            value={newLabel}
            onChange={(event) => setNewLabel(event.target.value)}
            placeholder="Ex.: Leads interessados"
          />
        </label>
        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancelar
          </button>
          <span className="footer-spacer" />
          <button
            type="button"
            className="primary-button"
            disabled={
              busy || (!selected.size && !newLabel.trim()) || !recipients.length
            }
            onClick={() => void apply()}
          >
            {busy
              ? "Organizando…"
              : `Aplicar a ${recipients.length} contato(s)`}
          </button>
        </footer>
      </section>
    </div>
  );
}

function BroadcastContactsModal({
  instanceId,
  listId,
  current,
  lists,
  googleSheet,
  onClose,
  onChanged,
  onError,
}: {
  instanceId: number;
  listId: string;
  current: JsonRecord[];
  lists: JsonRecord[];
  googleSheet: JsonRecord;
  onClose: () => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [available, setAvailable] = useState<JsonRecord[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"saved" | "instance" | "import">("saved");
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [savedQuery, setSavedQuery] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    api
      .conversations(instanceId, { includeContacts: true })
      .then((result) =>
        setAvailable(
          (
            [
              ...(result.threads || []),
              ...(result.conversations || []),
            ] as unknown as JsonRecord[]
          ).filter(
            (item, index, values) =>
              values.findIndex(
                (other) =>
                  String(other.chatJid || other.phone || other.id) ===
                  String(item.chatJid || item.phone || item.id),
              ) === index,
          ),
        ),
      )
      .catch(() => setAvailable([]));
  }, [instanceId]);
  useEffect(() => {
    if (tab !== "instance") return;
    void api
      .botGroups()
      .then((result) => {
        const rows: JsonRecord[] = listOf(result, ["groups", "items"]).map(
          (item) => ({
            ...item,
            chatType: "group",
            chatJid: item.remoteId || item.jid || item.chatJid,
            title: item.name || item.subject,
          }),
        );
        if (rows.length)
          setAvailable((current) =>
            [...current, ...rows].filter(
              (item, index, values) =>
                values.findIndex(
                  (other) =>
                    String(other.chatJid || other.phone || other.id) ===
                    String(item.chatJid || item.phone || item.id),
                ) === index,
            ),
          );
      })
      .catch(() => undefined);
  }, [tab]);
  const keyOf = (item: JsonRecord) =>
    textOf(item.chatJid || item.phone || item.id);
  const isGroup = (item: JsonRecord) =>
    String(item.chatType || item.recipientType || "")
      .toLowerCase()
      .includes("group") ||
    String(item.chatJid || item.jid || item.remoteId || "").endsWith("@g.us");
  const filtered = available.filter((item) =>
    `${textOf(item.title || item.name)} ${textOf(item.phone || item.chatJid || item.jid || item.remoteId)}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const toggle = (key: string) =>
    setSelected((currentSet) => {
      const next = new Set(currentSet);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const addSelected = async () => {
    const values = available.filter((item) => selected.has(keyOf(item)));
    const groups = values
      .filter(isGroup)
      .map((item) => ({
        remoteId: textOf(item.remoteId || item.jid || item.chatJid),
        jid: textOf(item.jid || item.chatJid || item.remoteId),
        name: item.title || item.name,
        recipientType: "group",
      }));
    const contacts = values
      .filter((item) => !isGroup(item))
      .map((item) => ({
        name: item.title || item.name,
        phone: textOf(item.phone || item.chatJid).replace(/\D/g, ""),
        source: "instance",
      }))
      .filter((item) => item.phone);
    if (!contacts.length && !groups.length) return;
    setBusy(true);
    try {
      await api.broadcastContacts(instanceId, listId, { contacts, groups });
      onChanged();
      setSelected(new Set());
      setTab("saved");
    } catch (cause) {
      onError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível adicionar os destinatários.",
      );
    } finally {
      setBusy(false);
    }
  };
  const importValues = async () => {
    const contacts = parseImportedContacts(manual);
    if (!contacts.length) return;
    setBusy(true);
    try {
      await api.broadcastContacts(instanceId, listId, { contacts });
      onChanged();
      setManual("");
      setTab("saved");
    } catch (cause) {
      onError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível importar destinatários.",
      );
    } finally {
      setBusy(false);
    }
  };
  const applySheet = async (url: string, mapping: JsonRecord) => {
    await api.broadcastContacts(instanceId, listId, {
      googleSheetUrl: url,
      googleSheetMapping: mapping,
    });
    await api.syncBroadcastGoogleSheet(instanceId, listId, true);
    setSheetOpen(false);
    onChanged();
  };
  const remove = async (ids?: string[]) => {
    if (
      !window.confirm(
        ids
          ? "Remover os destinatários selecionados?"
          : "Limpar todos os destinatários desta lista?",
      )
    )
      return;
    setBusy(true);
    try {
      await api.removeBroadcastContacts(
        instanceId,
        listId,
        ids ? { contactIds: ids } : {},
      );
      onChanged();
    } catch (cause) {
      onError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível remover destinatários.",
      );
    } finally {
      setBusy(false);
    }
  };
  const [currentSelected, setCurrentSelected] = useState<Set<string>>(
    new Set(),
  );
  const visibleCurrent = current.filter((item) =>
    `${textOf(item.name || item.pushName)} ${textOf(item.phone || item.jid || item.chatJid)}`
      .toLowerCase()
      .includes(savedQuery.toLowerCase()),
  );
  const selectedContacts = current.filter((item) =>
    currentSelected.has(textOf(item.id)),
  );
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="broadcast-editor-modal broadcast-contacts-modal"
        role="dialog"
        aria-modal="true"
      >
        <header>
          <div>
            <div className="modal-heading-line">
              <h2>Destinatários</h2>
              <InfoTip label="Destinatários">
                Gerencie contatos salvos, grupos da instância e importações sem duplicar números.
              </InfoTip>
            </div>
            <p>
              {current.length} salvo(s) · contatos e grupos repetidos são
              combinados automaticamente.
            </p>
          </div>
          <button onClick={onClose} aria-label="Fechar">
            <X />
          </button>
        </header>
        <div className="broadcast-contact-tabs">
          <button
            type="button"
            className={tab === "saved" ? "selected" : ""}
            onClick={() => setTab("saved")}
          >
            Nesta lista
          </button>
          <button
            type="button"
            className={tab === "instance" ? "selected" : ""}
            onClick={() => setTab("instance")}
          >
            Contatos e grupos
          </button>
          <button
            type="button"
            className={tab === "import" ? "selected" : ""}
            onClick={() => setTab("import")}
          >
            Importar
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setDiscoveryOpen(true)}
          >
            <UsersRound /> Procurar grupos
          </button>
        </div>
        {tab === "saved" && (
          <>
            <div className="broadcast-contact-search">
              <input
                value={savedQuery}
                onChange={(event) => setSavedQuery(event.target.value)}
                placeholder="Buscar contato, grupo ou número"
              />
            </div>
            <div className="broadcast-selection-bar">
              <button
                type="button"
                onClick={() =>
                  setCurrentSelected(
                    new Set(
                      visibleCurrent
                        .map((item) => textOf(item.id))
                        .filter(Boolean),
                    ),
                  )
                }
              >
                Selecionar todos
              </button>
              {currentSelected.size > 0 && (
                <>
                  <button type="button" onClick={() => setCurrentSelected(new Set())}>
                    Limpar seleção
                  </button>
                  {selectedContacts.some((item) => textOf(item.recipientType, "contact") !== "group") && (
                    <button type="button" onClick={() => setLabelsOpen(true)}>
                      Organizar em etiquetas
                    </button>
                  )}
                  <span>{currentSelected.size} selecionado(s)</span>
                </>
              )}
            </div>
            <div className="broadcast-contact-list">
              {visibleCurrent.length ? (
                visibleCurrent.map((item, index) => {
                  const id = textOf(item.id);
                  return (
                    <label key={id || index}>
                      <input
                        type="checkbox"
                        checked={currentSelected.has(id)}
                        onChange={() =>
                          setCurrentSelected((value) => {
                            const next = new Set(value);
                            if (next.has(id)) next.delete(id);
                            else next.add(id);
                            return next;
                          })
                        }
                      />
                      <span>
                        <b>{textOf(item.name, "Sem nome")}</b>
                        <small>
                          {textOf(item.phone || item.jid || item.chatJid)}
                        </small>
                      </span>
                      <em>{textOf(item.recipientType, "contato")}</em>
                    </label>
                  );
                })
              ) : (
                <div className="list-state">
                  Nenhum destinatário encontrado.
                </div>
              )}
            </div>
            <footer>
              <button
                type="button"
                className="secondary-button danger"
                disabled={busy || !current.length}
                onClick={() => void remove()}
              >
                Limpar lista
              </button>
              <span className="footer-spacer" />
              {currentSelected.size > 0 && (
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy}
                  onClick={() => void remove([...currentSelected])}
                >
                  Remover selecionados ({currentSelected.size})
                </button>
              )}
            </footer>
          </>
        )}
        {tab === "instance" && (
          <>
            <div className="broadcast-contact-search">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Pesquisar contato ou grupo"
              />
              <button
                type="button"
                onClick={() => setSelected(new Set(filtered.map(keyOf)))}
              >
                Selecionar todos
              </button>
              {selected.size > 0 && (
                <button type="button" onClick={() => setSelected(new Set())}>
                  Limpar seleção
                </button>
              )}
            </div>
            <div className="broadcast-contact-list">
              {filtered.map((item, index) => {
                const key = keyOf(item);
                return (
                  <label key={key || index}>
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      onChange={() => toggle(key)}
                    />
                    <span>
                      <b>{textOf(item.title || item.name, "Sem nome")}</b>
                      <small>{textOf(item.phone || item.chatJid)}</small>
                    </span>
                    <em>
                      {String(item.chatType || "").includes("group") ||
                      String(item.chatJid || "").includes("@g.us")
                        ? "grupo"
                        : "contato"}
                    </em>
                  </label>
                );
              })}
            </div>
            <footer>
              <span className="footer-spacer" />
              {selected.size > 0 && (
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy}
                  onClick={() => void addSelected()}
                >
                  Adicionar {selected.size} destinatário(s)
                </button>
              )}
            </footer>
          </>
        )}
        {tab === "import" && (
          <div className="broadcast-import-form">
            <label>
              Números manuais
              <textarea
                value={manual}
                onChange={(event) => setManual(event.target.value)}
                rows={7}
                placeholder={"Um por linha. Também aceita Nome | 5592999999999"}
              />
            </label>
            <section className="broadcast-sheet-entry">
              <b>Google Sheets</b>
              <p>
                {googleSheet.configured
                  ? `${Number((googleSheet.mapping as JsonRecord | undefined)?.estimatedContacts || 0)} contato(s) mapeado(s) · sincronização ativa`
                  : "Conecte sua conta, escolha a planilha e mapeie as colunas com prévia."}
              </p>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setSheetOpen(true)}
              >
                {googleSheet.configured
                  ? "Editar planilha mapeada"
                  : "Importar e mapear Google Sheets"}
              </button>
            </section>
            <input
              ref={importRef}
              type="file"
              accept=".csv,.json,.txt,text/csv,application/json,text/plain"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                void file.text().then((value) => setManual(value));
              }}
            />
            <p>
              Cole números ou importe CSV/JSON. Telefones repetidos são
              combinados automaticamente.
            </p>
            <div className="broadcast-import-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => importRef.current?.click()}
              >
                Importar CSV/JSON
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={busy || !manual.trim()}
                onClick={() => void importValues()}
              >
                Importar e combinar
              </button>
            </div>
          </div>
        )}
      </section>
      {discoveryOpen && (
        <BroadcastGroupDiscoveryModal
          instanceId={instanceId}
          onClose={() => setDiscoveryOpen(false)}
          onChanged={onChanged}
          onError={onError}
        />
      )}
      {labelsOpen && (
        <BroadcastLabelsModal
          instanceId={instanceId}
          currentListId={listId}
          lists={lists}
          contacts={selectedContacts}
          onClose={() => setLabelsOpen(false)}
          onChanged={onChanged}
          onError={onError}
        />
      )}
      {sheetOpen && (
        <GoogleSheetMapperModal
          initial={googleSheet}
          onClose={() => setSheetOpen(false)}
          onApply={applySheet}
          onError={onError}
        />
      )}
    </div>
  );
}

function BroadcastProgressModal({
  run,
  contacts,
  onClose,
}: {
  run: JsonRecord;
  contacts: JsonRecord[];
  onClose: () => void;
}) {
  const sent = Number(run.sent || run.sentTotal || 0);
  const failed = Number(run.failed || run.failedTotal || 0);
  const total = Number(
    run.total || run.totalRecipients || contacts.length || 0,
  );
  const percent = total
    ? Math.min(100, Math.round(((sent + failed) / total) * 100))
    : 0;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="broadcast-editor-modal broadcast-progress-modal"
        role="dialog"
        aria-modal="true"
      >
        <header>
          <div>
            <div className="modal-heading-line">
              <h2>Progresso da transmissão</h2>
              <InfoTip label="Progresso da transmissão">
                Acompanhe em tempo real os envios concluídos, pendentes e com falha.
              </InfoTip>
            </div>
            <p>
              {sent}/{total || "—"} enviados · {failed} falha(s)
            </p>
          </div>
          <button onClick={onClose} aria-label="Fechar">
            <X />
          </button>
        </header>
        <div className="broadcast-progress-summary">
          <strong>{percent}%</strong>
          <div>
            <span style={{ width: `${percent}%` }} />
          </div>
        </div>
        <div className="broadcast-progress-list">
          {contacts.length ? (
            contacts.map((contact, index) => (
              <div key={String(contact.id || contact.phone || index)}>
                <span>
                  <b>{textOf(contact.name, "Sem nome")}</b>
                  <small>{textOf(contact.phone || contact.jid)}</small>
                </span>
                <em className={textOf(contact.status, "pending")}>
                  {textOf(contact.status, "pending")}
                </em>
              </div>
            ))
          ) : (
            <div className="list-state">
              O servidor ainda está preparando os detalhes por destinatário.
            </div>
          )}
        </div>
        <footer>
          <span className="footer-spacer" />
          <button className="primary-button" onClick={onClose}>
            Fechar
          </button>
        </footer>
      </section>
    </div>
  );
}

function BroadcastScheduleModal({
  schedule,
  busy,
  onClose,
  onApply,
}: {
  schedule: JsonRecord;
  busy: boolean;
  onClose: () => void;
  onApply: (payload: JsonRecord) => void;
}) {
  const payload = (
    schedule.payload && typeof schedule.payload === "object"
      ? schedule.payload
      : {}
  ) as JsonRecord;
  const quiet = (
    payload.quietHours && typeof payload.quietHours === "object"
      ? payload.quietHours
      : {}
  ) as JsonRecord;
  const [recurrence, setRecurrence] = useState(
    textOf(schedule.recurrenceMinutes, "60"),
  );
  const [scheduledAt, setScheduledAt] = useState(
    textOf(schedule.scheduledFor || schedule.scheduledAt).slice(0, 16),
  );
  const [quietEnabled, setQuietEnabled] = useState(quiet.enabled === true);
  const [quietStart, setQuietStart] = useState(
    clockOf(quiet.startMinutes ?? quiet.start, "22:00"),
  );
  const [quietEnd, setQuietEnd] = useState(
    clockOf(quiet.endMinutes ?? quiet.end, "08:00"),
  );
  const minutes = (value: string) => {
    const [hours, mins] = value.split(":").map(Number);
    return Math.max(0, Math.min(1439, (hours || 0) * 60 + (mins || 0)));
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="broadcast-editor-modal broadcast-schedule-modal">
        <header>
          <div>
            <div className="modal-heading-line">
              <h2>Editar programação</h2>
              <InfoTip label="Editar programação">
                Defina o próximo envio, a recorrência e o intervalo de pausa noturna da transmissão.
              </InfoTip>
            </div>
            <p>Altere o próximo horário, recorrência e pausa noturna.</p>
          </div>
          <button onClick={onClose} aria-label="Fechar">
            <X />
          </button>
        </header>
        <label>
          Próximo envio
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(event) => setScheduledAt(event.target.value)}
          />
        </label>
        <label>
          Recorrência em minutos
          <input
            inputMode="numeric"
            value={recurrence}
            onChange={(event) =>
              setRecurrence(event.target.value.replace(/\D/g, ""))
            }
          />
          <span>Use 0 para enviar somente uma vez.</span>
        </label>
        <label className="settings-inline-toggle">
          <input
            type="checkbox"
            checked={quietEnabled}
            onChange={(event) => setQuietEnabled(event.target.checked)}
          />{" "}
          Pausa automática à noite
        </label>
        {quietEnabled && (
          <div className="broadcast-schedule-fields">
            <label>
              Pausar às
              <input
                type="time"
                value={quietStart}
                onChange={(event) => setQuietStart(event.target.value)}
              />
            </label>
            <label>
              Retomar às
              <input
                type="time"
                value={quietEnd}
                onChange={(event) => setQuietEnd(event.target.value)}
              />
            </label>
          </div>
        )}
        <footer>
          <button className="secondary-button" onClick={onClose}>
            Cancelar
          </button>
          <span className="footer-spacer" />
          <button
            className="primary-button"
            disabled={busy}
            onClick={() =>
              onApply({
                scheduleId: schedule.id,
                recurrenceMinutes: Number(recurrence) || 0,
                ...(scheduledAt ? { scheduledAt } : {}),
                timezone:
                  Intl.DateTimeFormat().resolvedOptions().timeZone ||
                  "America/Sao_Paulo",
                quietHours: {
                  enabled: quietEnabled,
                  startMinutes: minutes(quietStart),
                  endMinutes: minutes(quietEnd),
                  timezone:
                    Intl.DateTimeFormat().resolvedOptions().timeZone ||
                    "America/Sao_Paulo",
                },
              })
            }
          >
            Salvar programação
          </button>
        </footer>
      </section>
    </div>
  );
}

function BroadcastEditorModal({
  detail,
  instanceId,
  listId,
  initialBody,
  initialName,
  initialMedia,
  initialPayload,
  initialTemplateId,
  editing,
  onClose,
  onSaved,
  onError,
  onUpdateMentions,
  onEditMessage,
  onChangeMessage,
  onSaveContent,
  saveButtonLabel,
}: {
  detail: JsonRecord;
  instanceId: number;
  listId: string;
  initialBody: string;
  initialName: string;
  initialMedia: JsonRecord | null;
  initialPayload?: JsonRecord;
  initialTemplateId?: string | null;
  editing: boolean;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
  onUpdateMentions?: (mentionAll: boolean, excludeAdmins: boolean) => void;
  onEditMessage?: () => void;
  onChangeMessage?: () => void;
  onSaveContent?: (payload: JsonRecord) => Promise<unknown>;
  saveButtonLabel?: string;
}) {
  const sourcePayload = initialPayload || {};
  const [templateName, setTemplateName] = useState(initialName);
  const [drafts, setDrafts] = useState<BroadcastVariantDraft[]>(() => {
    const root: BroadcastVariantDraft = {
      name: "Principal",
      body: initialBody,
      media: initialMedia,
      buttons: buttonsFromValue(sourcePayload.buttons),
      variables: listOf(sourcePayload, ["variables"]),
    };
    const stored = listOf(sourcePayload, ["messageVariants"]);
    if (!stored.length) return [root];
    const mapped = stored.map((item, index) => ({
      name: textOf(item.name, index === 0 ? "Principal" : `Variação ${index}`),
      body: textOf(item.body || item.text),
      media:
        item.media && typeof item.media === "object"
          ? (item.media as JsonRecord)
          : null,
      buttons: buttonsFromValue(item.buttons),
      variables: listOf(item, ["variables"]),
    }));
    const first = mapped[0];
    const includesPrincipal = Boolean(
      first &&
      (first.name.toLowerCase() === "principal" ||
        first.body.trim() === root.body.trim()),
    );
    return includesPrincipal ? mapped : [root, ...mapped];
  });
  const [activeDraft, setActiveDraft] = useState(0);
  const [typing, setTyping] = useState(true);
  const [mode, setMode] = useState<"send" | "schedule" | "recurring">("send");
  const [minDelay, setMinDelay] = useState("30");
  const [maxDelay, setMaxDelay] = useState("60");
  const [batchSize, setBatchSize] = useState("20");
  const [batchPauseMin, setBatchPauseMin] = useState("180");
  const [batchPauseMax, setBatchPauseMax] = useState("300");
  const [quiet, setQuiet] = useState(false);
  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("08:00");
  const [scheduledAt, setScheduledAt] = useState("");
  const [recurrence, setRecurrence] = useState("");
  const [recurrenceUnit, setRecurrenceUnit] = useState<
    "minutes" | "hours" | "days"
  >("hours");
  const [mentionAll, setMentionAll] = useState(() =>
    listOf(detail, ["contacts"]).some(
      (item) => item.recipientType === "group" && item.mentionAll === true,
    ),
  );
  const [excludeAdmins, setExcludeAdmins] = useState(() =>
    listOf(detail, ["contacts"]).some(
      (item) => item.recipientType === "group" && item.excludeAdmins === true,
    ),
  );
  const [submodal, setSubmodal] = useState<"buttons" | "variables" | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const draft = drafts[activeDraft] || drafts[0];
  const primary = drafts[0];
  const updateDraft = (index: number, patch: Partial<BroadcastVariantDraft>) =>
    setDrafts((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  const serializedDrafts = drafts.map((item) => ({
    name: item.name,
    body: item.body.trim(),
    ...(item.media ? { media: item.media } : {}),
    ...(item.buttons.length ? { buttons: item.buttons } : {}),
    ...(item.variables.length ? { variables: item.variables } : {}),
  }));
  const valid =
    (!editing || Boolean(onSaveContent) || Boolean(templateName.trim())) &&
    drafts.every(
      (item) => item.body.trim() || item.media || item.buttons.length,
    );
  const dispatchPayload = () => {
    const minSeconds = Math.min(300, Math.max(10, Number(minDelay) || 30));
    const maxSeconds = Math.min(
      300,
      Math.max(minSeconds, Number(maxDelay) || 60),
    );
    const pauseMinSeconds = Math.min(
      1800,
      Math.max(60, Number(batchPauseMin) || 180),
    );
    const pauseMaxSeconds = Math.min(
      1800,
      Math.max(pauseMinSeconds, Number(batchPauseMax) || 300),
    );
    const minutes = (value: string) => {
      const [hours, mins] = value.split(":").map(Number);
      return (
        (Number.isFinite(hours) ? hours : 0) * 60 +
        (Number.isFinite(mins) ? mins : 0)
      );
    };
    return {
      body: primary.body.trim(),
      typingEnabled: typing,
      minDelayMs: minSeconds * 1000,
      maxDelayMs: maxSeconds * 1000,
      pacing: {
        batchSize: Math.max(5, Number(batchSize) || 20),
        batchPauseMinMs: pauseMinSeconds * 1000,
        batchPauseMaxMs: pauseMaxSeconds * 1000,
      },
      ...(primary.media ? { media: primary.media } : {}),
      ...(primary.buttons.length ? { buttons: primary.buttons } : {}),
      ...(primary.variables.length ? { variables: primary.variables } : {}),
      ...(drafts.length >= 2 ? { messageVariants: serializedDrafts } : {}),
      ...(mentionAll ? { mentionAll, excludeAdmins } : {}),
      ...(quiet
        ? {
            quietHours: {
              enabled: true,
              startMinutes: minutes(quietStart),
              endMinutes: minutes(quietEnd),
              timezone:
                Intl.DateTimeFormat().resolvedOptions().timeZone ||
                "America/Sao_Paulo",
            },
          }
        : {}),
    } as JsonRecord;
  };
  const save = async (action: "template" | "dispatch") => {
    if (
      !valid ||
      busy ||
      (action === "dispatch" && mode !== "send" && !scheduledAt)
    )
      return;
    setBusy(true);
    try {
      if (action === "template") {
        const contentPayload = {
          body: primary.body.trim(),
          ...(!onSaveContent
            ? { typingEnabled: true, minDelayMs: 30_000, maxDelayMs: 60_000 }
            : {}),
          ...(primary.media ? { media: primary.media } : {}),
          ...(primary.buttons.length ? { buttons: primary.buttons } : {}),
          ...(primary.variables.length ? { variables: primary.variables } : {}),
          ...(drafts.length >= 2 ? { messageVariants: serializedDrafts } : {}),
        } as JsonRecord;
        if (onSaveContent) await onSaveContent(contentPayload);
        else
          await api.broadcastTemplates(instanceId, listId, {
            ...(initialTemplateId ? { templateId: initialTemplateId } : {}),
            templateName: templateName.trim(),
            ...contentPayload,
          });
      } else {
        if (
          detail.googleSheet &&
          typeof detail.googleSheet === "object" &&
          (detail.googleSheet as JsonRecord).configured === true
        ) {
          try {
            const sheet = await api.syncBroadcastGoogleSheet(
              instanceId,
              listId,
            );
            const amount = Number(sheet.newContacts || 0);
            if (amount > 0) {
              const preview = listOf(sheet, ["preview"])
                .slice(0, 5)
                .map(
                  (item) =>
                    `${textOf(item.name, "Sem nome")} · ${textOf(item.phone)}`,
                )
                .join("\n");
              const include = window.confirm(
                `A planilha possui ${amount} novo(s) contato(s).\n\n${preview}\n\nDeseja incluí-los nesta transmissão?`,
              );
              if (include)
                await api.syncBroadcastGoogleSheet(instanceId, listId, true);
              else if (
                !window.confirm(
                  "Continuar usando somente os destinatários que já estão salvos?",
                )
              )
                return;
            }
          } catch (cause) {
            const message =
              cause instanceof Error
                ? cause.message
                : "Não foi possível conferir a planilha.";
            if (
              !window.confirm(
                `${message}\n\nContinuar usando os destinatários já salvos?`,
              )
            )
              return;
          }
        }
        const payload = dispatchPayload();
        if (mode === "send")
          await api.sendBroadcast(instanceId, listId, payload);
        else
          await api.scheduleBroadcast(instanceId, listId, {
            ...payload,
            scheduledAt,
            recurrenceMinutes:
              mode === "recurring"
                ? Math.max(1, Number(recurrence) || 24) *
                  (recurrenceUnit === "days"
                    ? 1440
                    : recurrenceUnit === "hours"
                      ? 60
                      : 1)
                : undefined,
            timezone:
              Intl.DateTimeFormat().resolvedOptions().timeZone ||
              "America/Sao_Paulo",
          });
      }
      onSaved();
    } catch (cause) {
      onError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível concluir a transmissão.",
      );
    } finally {
      setBusy(false);
    }
  };
  const upload = async (file: File) => {
    const draftIndex = activeDraft;
    setBusy(true);
    try {
      const kind = file.type.startsWith("video")
        ? "video"
        : file.type.startsWith("audio")
          ? "audio"
          : file.type.startsWith("image")
            ? "image"
            : "document";
      const result = await api.uploadBroadcastMedia(
        instanceId,
        listId,
        file,
        kind,
      );
      updateDraft(draftIndex, {
        media: (result.media || result) as JsonRecord,
      });
    } catch (cause) {
      onError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível enviar a mídia.",
      );
    } finally {
      setBusy(false);
    }
  };
  const addVariant = () => {
    if (drafts.length >= 12) {
      onError("Use no máximo 12 variações por modelo.");
      return;
    }
    const copy: BroadcastVariantDraft = {
      name: `Variação ${drafts.length}`,
      body: draft.body,
      media: draft.media ? { ...draft.media } : null,
      buttons: draft.buttons.map((item) => ({ ...item })),
      variables: draft.variables.map((item) => ({ ...item })),
    };
    setDrafts((current) => [...current, copy]);
    setActiveDraft(drafts.length);
  };
  const removeVariant = (index: number) => {
    if (index === 0) return;
    setDrafts((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
    setActiveDraft((current) =>
      current >= index ? Math.max(0, current - 1) : current,
    );
  };
  const mediaKind = textOf(
    draft.media?.mimeType || draft.media?.mediaType || draft.media?.type,
  );
  const mediaUrl = draft.media
    ? absoluteMediaUrl(
        textOf(draft.media.url || draft.media.mediaUrl || draft.media.path),
      )
    : "";
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="broadcast-editor-modal"
        role="dialog"
        aria-modal="true"
      >
        <header>
          <div>
            <div className="modal-heading-line">
              <h2>
                {editing
                  ? `Editor · ${templateName || "Nova mensagem"} · ${draft.name}`
                  : `Preparar transmissão · ${templateName || "Mensagem salva"}`}
              </h2>
              <InfoTip label="Editor de transmissão">
                Monte o texto, mídia, botões, variações e horários. As opções são aplicadas somente após confirmar.
              </InfoTip>
            </div>
            <p>
              {editing
                ? "Cada variação pode ter texto, mídia, botões e variáveis próprios."
                : `${listOf(detail, ["contacts"]).length} destinatário(s) · escolha quando e como enviar.`}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            <X />
          </button>
        </header>
        {editing && (
          <>
            {!onSaveContent && (
              <label>
                Nome do modelo
                <input
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                  placeholder="Ex.: Oferta da semana"
                />
              </label>
            )}
            <section
              className="broadcast-variant-workspace"
              aria-label="Versões da mensagem"
            >
              <div className="broadcast-variant-heading">
                <span>
                  <b>1. Escolha a versão que deseja editar</b>
                  <small>
                    A versão destacada em verde está aberta logo abaixo.
                  </small>
                </span>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={addVariant}
                >
                  <Plus /> Criar variação desta versão
                </button>
              </div>
              <div className="broadcast-variant-chips">
                {drafts.map((item, index) => (
                  <button
                    type="button"
                    className={activeDraft === index ? "selected" : ""}
                    key={`${item.name}:${index}`}
                    onClick={() => setActiveDraft(index)}
                  >
                    <span>{index === 0 ? "★" : index + 1}</span>
                    <span className="broadcast-variant-chip-copy">
                      <b>{item.name}</b>
                      <small>
                        {activeDraft === index
                          ? "Editando agora"
                          : "Clique para editar"}
                      </small>
                    </span>
                    {index > 0 && (
                      <X
                        aria-label={`Remover ${item.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          removeVariant(index);
                        }}
                      />
                    )}
                  </button>
                ))}
              </div>
            </section>
            <section className="broadcast-active-variant">
              <div className="broadcast-active-variant-title">
                <span>
                  <b>2. Editando: {draft.name}</b>
                  <small>
                    Texto, mídia, botões e variáveis pertencem somente a esta
                    versão.
                  </small>
                </span>
                {activeDraft > 0 && (
                  <label>
                    Nome da versão
                    <input
                      value={draft.name}
                      onChange={(event) =>
                        updateDraft(activeDraft, {
                          name: event.target.value || `Variação ${activeDraft}`,
                        })
                      }
                    />
                  </label>
                )}
              </div>
              <div className="broadcast-editor-tools">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => fileRef.current?.click()}
                >
                  <Paperclip />{" "}
                  {draft.media
                    ? textOf(
                        draft.media.fileName || draft.media.name,
                        "Mídia pronta",
                      )
                    : "Adicionar mídia"}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void upload(file);
                  }}
                />
                <button
                  type="button"
                  className={`secondary-button ${draft.variables.length ? "active" : ""}`}
                  onClick={() => setSubmodal("variables")}
                >
                  ▣{" "}
                  {draft.variables.length
                    ? `${draft.variables.length} variáveis`
                    : "Variáveis"}
                </button>
                <button
                  type="button"
                  className={`secondary-button ${draft.buttons.length ? "active" : ""}`}
                  onClick={() => setSubmodal("buttons")}
                >
                  ☷{" "}
                  {draft.buttons.length
                    ? `${draft.buttons.length} botões`
                    : "Botões"}
                </button>
                {draft.media && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => updateDraft(activeDraft, { media: null })}
                  >
                    Remover mídia
                  </button>
                )}
              </div>
              <label>
                Mensagem da {draft.name}
                <textarea
                  autoFocus
                  value={draft.body}
                  onChange={(event) =>
                    updateDraft(activeDraft, { body: event.target.value })
                  }
                  rows={6}
                  placeholder="Digite a mensagem da transmissão…"
                />
              </label>
            </section>
            {draft.media && (
              <div className="broadcast-media-preview">
                {mediaKind.includes("video") ? (
                  <video controls src={mediaUrl} />
                ) : mediaKind.includes("audio") ? (
                  <audio controls src={mediaUrl} />
                ) : mediaKind.includes("pdf") ||
                  mediaKind.includes("document") ? (
                  <a
                    className="broadcast-document-preview"
                    href={mediaUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    📄{" "}
                    {textOf(
                      draft.media.fileName || draft.media.name,
                      "Documento",
                    )}
                  </a>
                ) : (
                  <img src={mediaUrl} alt="Prévia da mídia" />
                )}
              </div>
            )}
          </>
        )}
        {drafts.length >= 2 && !editing && (
          <div className="broadcast-randomizer-notice">
            ↗ Randomizador ativo: <b>{drafts.length} versões</b> deste mesmo
            modelo serão alternadas entre os destinatários.
          </div>
        )}
        <BroadcastPreviewCard
          body={draft.body}
          media={draft.media}
          buttons={draft.buttons}
        />
        {!editing && (
          <details className="broadcast-advanced" open>
            <summary>Configurações de envio</summary>
            <div className="broadcast-mode-chips">
              <button
                type="button"
                className={mode === "send" ? "selected" : ""}
                onClick={() => setMode("send")}
              >
                Agora
              </button>
              <button
                type="button"
                className={mode === "schedule" ? "selected" : ""}
                onClick={() => setMode("schedule")}
              >
                Agendar
              </button>
              <button
                type="button"
                className={mode === "recurring" ? "selected" : ""}
                onClick={() => setMode("recurring")}
              >
                Recorrente
              </button>
            </div>
            <div className="broadcast-send-summary">
              <span>
                <b>{drafts.length}</b> variação(ões)
              </span>
              <label className="settings-inline-toggle">
                <input
                  type="checkbox"
                  checked={typing}
                  onChange={(event) => setTyping(event.target.checked)}
                />{" "}
                Simular digitação
              </label>
            </div>
            <div className="broadcast-delay-grid">
              <label>
                Delay mínimo (s)
                <input
                  inputMode="numeric"
                  value={minDelay}
                  onChange={(event) =>
                    setMinDelay(event.target.value.replace(/\D/g, ""))
                  }
                />
              </label>
              <label>
                Delay máximo (s)
                <input
                  inputMode="numeric"
                  value={maxDelay}
                  onChange={(event) =>
                    setMaxDelay(event.target.value.replace(/\D/g, ""))
                  }
                />
              </label>
              <label>
                Mensagens por lote
                <input
                  inputMode="numeric"
                  value={batchSize}
                  onChange={(event) =>
                    setBatchSize(event.target.value.replace(/\D/g, ""))
                  }
                />
              </label>
              <label>
                Pausa mín. lote (s)
                <input
                  inputMode="numeric"
                  value={batchPauseMin}
                  onChange={(event) =>
                    setBatchPauseMin(event.target.value.replace(/\D/g, ""))
                  }
                />
              </label>
              <label>
                Pausa máx. lote (s)
                <input
                  inputMode="numeric"
                  value={batchPauseMax}
                  onChange={(event) =>
                    setBatchPauseMax(event.target.value.replace(/\D/g, ""))
                  }
                />
              </label>
              <label className="settings-inline-toggle">
                <input
                  type="checkbox"
                  checked={quiet}
                  onChange={(event) => setQuiet(event.target.checked)}
                />{" "}
                Pausa noturna
              </label>
              {quiet && (
                <>
                  <label>
                    Início
                    <input
                      type="time"
                      value={quietStart}
                      onChange={(event) => setQuietStart(event.target.value)}
                    />
                  </label>
                  <label>
                    Fim
                    <input
                      type="time"
                      value={quietEnd}
                      onChange={(event) => setQuietEnd(event.target.value)}
                    />
                  </label>
                </>
              )}
            </div>
            <p className="broadcast-delay-help">
              Intervalo aleatório persistido entre cada envio. Recomendado:
              30–60 segundos. Após cada lote, a fila aguarda uma pausa maior.
            </p>
            {mode !== "send" && (
              <div className="broadcast-schedule-fields">
                <label>
                  Data e horário
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(event) => setScheduledAt(event.target.value)}
                  />
                </label>
                {mode === "recurring" && (
                  <>
                    <label>
                      Repetir a cada
                      <input
                        inputMode="numeric"
                        value={recurrence}
                        onChange={(event) =>
                          setRecurrence(event.target.value.replace(/\D/g, ""))
                        }
                      />
                    </label>
                    <label>
                      Unidade
                      <select
                        value={recurrenceUnit}
                        onChange={(event) =>
                          setRecurrenceUnit(
                            event.target.value as typeof recurrenceUnit,
                          )
                        }
                      >
                        <option value="minutes">Minutos</option>
                        <option value="hours">Horas</option>
                        <option value="days">Dias</option>
                      </select>
                    </label>
                  </>
                )}
              </div>
            )}
            {listOf(detail, ["contacts"]).length > 0 && (
              <div className="broadcast-mention-options">
                <label className="settings-inline-toggle">
                  <input
                    type="checkbox"
                    checked={mentionAll}
                    onChange={(event) => {
                      setMentionAll(event.target.checked);
                      onUpdateMentions?.(
                        event.target.checked,
                        event.target.checked ? excludeAdmins : false,
                      );
                    }}
                  />{" "}
                  Mencionar participantes dos grupos
                </label>
                {mentionAll && (
                  <label className="settings-inline-toggle">
                    <input
                      type="checkbox"
                      checked={excludeAdmins}
                      onChange={(event) => {
                        setExcludeAdmins(event.target.checked);
                        onUpdateMentions?.(true, event.target.checked);
                      }}
                    />{" "}
                    Não mencionar administradores
                  </label>
                )}
              </div>
            )}
          </details>
        )}
        <footer>
          {editing ? (
            <>
              <button
                className="secondary-button"
                type="button"
                onClick={onClose}
              >
                Cancelar
              </button>
              <span className="footer-spacer" />
              <button
                className="primary-button"
                type="button"
                onClick={() => void save("template")}
                disabled={busy || !valid}
              >
                <CheckSquare />{" "}
                {busy
                  ? "Salvando…"
                  : saveButtonLabel ||
                    (initialTemplateId
                      ? "Salvar alterações"
                      : "Criar mensagem")}
              </button>
            </>
          ) : (
            <>
              <button
                className="secondary-button"
                type="button"
                onClick={onChangeMessage}
              >
                Trocar mensagem
              </button>
              {onEditMessage && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={onEditMessage}
                >
                  <Pencil /> Editar mensagem
                </button>
              )}
              <span className="footer-spacer" />
              <button
                className="primary-button"
                type="button"
                onClick={() => void save("dispatch")}
                disabled={busy || !valid || (mode !== "send" && !scheduledAt)}
              >
                {mode === "send" ? <Send /> : <RadioTower />}{" "}
                {busy
                  ? "Processando…"
                  : mode === "send"
                    ? "Iniciar transmissão"
                    : mode === "recurring"
                      ? "Ativar recorrência"
                      : "Agendar transmissão"}
              </button>
            </>
          )}
        </footer>
        {submodal === "buttons" && (
          <BroadcastButtonsModal
            initial={draft.buttons}
            onClose={() => setSubmodal(null)}
            onApply={(next) => {
              updateDraft(activeDraft, { buttons: next });
              setSubmodal(null);
            }}
          />
        )}
        {submodal === "variables" && (
          <BroadcastVariablesModal
            initial={draft.variables}
            contacts={listOf(detail, ["contacts"])}
            instanceId={instanceId}
            listId={listId}
            body={draft.body}
            onClose={() => setSubmodal(null)}
            onApply={(next) => {
              updateDraft(activeDraft, { variables: next });
              setSubmodal(null);
            }}
          />
        )}
      </section>
    </div>
  );
}

export default function BroadcastWorkspace({ selectedInstance }: Props) {
  const [lists, setLists] = useState<JsonRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<JsonRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<JsonRecord | null>(null);
  const [editorTemplate, setEditorTemplate] = useState<
    JsonRecord | null | undefined
  >(undefined);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [progressRun, setProgressRun] = useState<JsonRecord | null>(null);
  const [scheduleEdit, setScheduleEdit] = useState<JsonRecord | null>(null);
  const [scheduleMessageEdit, setScheduleMessageEdit] =
    useState<JsonRecord | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const loadLists = useCallback(async () => {
    if (!selectedInstance) {
      setLists([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await api.broadcastLists(selectedInstance);
      const next = listOf(result, ["lists", "items"]);
      setLists(next);
      setSelectedId((current) =>
        current && next.some((item) => String(item.id) === current)
          ? current
          : window.innerWidth > 820 && next[0]?.id
            ? String(next[0].id)
            : null,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar as listas.",
      );
    } finally {
      setLoading(false);
    }
  }, [selectedInstance]);
  const openList = useCallback(
    async (id: string, quiet = false) => {
      if (!selectedInstance) return;
      setSelectedId(id);
      setLoadingDetail((current) => (quiet ? current : true));
      setError("");
      try {
        setDetail(await api.broadcastList(selectedInstance, id));
      } catch (cause) {
        setDetail(null);
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível abrir a lista.",
        );
      } finally {
        setLoadingDetail(false);
      }
    },
    [selectedInstance],
  );
  useEffect(() => {
    void loadLists();
  }, [loadLists]);
  useEffect(() => {
    if (selectedId) void openList(selectedId);
    else setDetail(null);
  }, [selectedId, openList]);
  const list = (detail?.list || {}) as JsonRecord;
  const contacts = listOf(detail, ["contacts"]);
  const schedules = listOf(detail, ["schedules"]);
  const messages = listOf(detail, ["messages", "history", "runs"]).filter(
    (item) => {
      const itemPayload = payloadFrom(item);
      return Boolean(
        item.body ||
        item.text ||
        item.message ||
        mediaFrom(item) ||
        listOf(item, ["buttons"]).length ||
        listOf(itemPayload, ["buttons"]).length,
      );
    },
  );
  const runs = listOf(detail, ["runs"]);
  const runContacts = listOf(detail, ["latestRunContacts", "runContacts"]);
  useEffect(() => {
    if (!selectedId || !detail) return;
    const running =
      runs.some((run) =>
        ["queued", "running", "sending"].includes(
          textOf(run.status).toLowerCase(),
        ),
      ) ||
      schedules.some(
        (schedule) => textOf(schedule.status).toLowerCase() === "pending",
      );
    if (!running) return;
    const timer = window.setInterval(() => {
      void openList(selectedId, true);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [selectedId, detail, runs, schedules, openList]);
  useEffect(() => {
    if (!progressRun || !detail) return;
    const current = runs.find(
      (run) => String(run.id || "") === String(progressRun.id || ""),
    );
    if (current && current !== progressRun) setProgressRun(current);
  }, [detail, progressRun, runs]);
  const templates = listOf(detail, ["templates"]);
  const createList = async (
    name: string,
    description: string,
    initialContacts: JsonRecord[],
    googleSheetUrl: string,
  ) => {
    if (!selectedInstance || busy) return;
    setBusy(true);
    try {
      const created = await api.createBroadcastList(selectedInstance, {
        name,
        description,
        contacts: initialContacts,
      });
      const createdId = created.id
        ? String(created.id)
        : created.list && typeof created.list === "object"
          ? textOf((created.list as JsonRecord).id)
          : "";
      if (createdId && googleSheetUrl)
        await api.broadcastContacts(selectedInstance, createdId, {
          googleSheetUrl,
        });
      setCreateOpen(false);
      setNotice("Lista criada.");
      await loadLists();
      if (createdId) await openList(createdId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível criar a lista.",
      );
    } finally {
      setBusy(false);
    }
  };
  const deleteList = async () => {
    if (
      !selectedInstance ||
      !selectedId ||
      !window.confirm("Apagar esta lista, modelos e agendamentos?")
    )
      return;
    setBusy(true);
    try {
      await api.deleteBroadcastList(selectedInstance, selectedId);
      setSelectedId(null);
      setDetail(null);
      setNotice("Lista apagada.");
      await loadLists();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível apagar a lista.",
      );
    } finally {
      setBusy(false);
    }
  };
  const toggleSchedule = async (schedule: JsonRecord) => {
    if (!selectedInstance || !selectedId || !schedule.id || busy) return;
    const status = textOf(schedule.status).toLowerCase();
    const active =
      schedule.enabled !== false &&
      ["pending", "queued", "running"].includes(status);
    setBusy(true);
    try {
      await api.updateBroadcastSchedule(selectedInstance, selectedId, {
        scheduleId: schedule.id,
        enabled: !active,
      });
      setNotice(active ? "Agendamento pausado." : "Agendamento ativado.");
      await openList(selectedId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível alterar o agendamento.",
      );
    } finally {
      setBusy(false);
    }
  };
  const removeSchedule = async (schedule: JsonRecord) => {
    if (
      !selectedInstance ||
      !selectedId ||
      !schedule.id ||
      busy ||
      !window.confirm("Excluir este agendamento?")
    )
      return;
    setBusy(true);
    try {
      await api.deleteBroadcastSchedule(selectedInstance, selectedId, {
        scheduleId: schedule.id,
      });
      setNotice("Agendamento excluído.");
      await openList(selectedId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível excluir o agendamento.",
      );
    } finally {
      setBusy(false);
    }
  };
  const applyScheduleEdit = async (payload: JsonRecord) => {
    if (!selectedInstance || !selectedId || busy) return;
    setBusy(true);
    try {
      await api.updateBroadcastSchedule(selectedInstance, selectedId, payload);
      setScheduleEdit(null);
      setNotice("Programação atualizada.");
      await openList(selectedId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível atualizar a programação.",
      );
    } finally {
      setBusy(false);
    }
  };
  const deleteTemplate = async (templateId: string) => {
    if (
      !selectedInstance ||
      !selectedId ||
      busy ||
      !window.confirm(
        "Excluir esta mensagem salva? Ela deixará de aparecer nesta lista.",
      )
    )
      return;
    setBusy(true);
    try {
      await api.deleteBroadcastTemplate(
        selectedInstance,
        selectedId,
        templateId,
      );
      if (String(activeTemplate?.id || "") === templateId)
        setActiveTemplate(null);
      setNotice("Mensagem salva excluída.");
      await openList(selectedId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível excluir a mensagem salva.",
      );
    } finally {
      setBusy(false);
    }
  };
  const updateMentions = async (mention: boolean, exclude: boolean) => {
    if (!selectedInstance || !selectedId) return;
    try {
      await api.updateBroadcastGroupMentions(selectedInstance, selectedId, {
        mentionAll: mention,
        excludeAdmins: mention ? exclude : false,
      });
      await openList(selectedId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível atualizar as menções.",
      );
    }
  };
  if (!selectedInstance)
    return (
      <main className="module production-broadcast-empty">
        <RadioTower />
        <b>Conecte um perfil para usar transmissões.</b>
      </main>
    );
  return (
    <main
      className={`module broadcast-workspace production-broadcast ${selectedId ? "has-selection" : ""}`}
    >
      <header className="broadcast-left-header">
        <div className="broadcast-pane-title">
          <span>
            <RadioTower />
          </span>
          <div>
            <h1>Transmissões</h1>
            <p>Listas, modelos, agendamentos e acompanhamento dos envios.</p>
          </div>
        </div>
        <div className="broadcast-left-actions">
          <button
            onClick={() => void loadLists()}
            aria-label="Atualizar listas"
          >
            <RefreshCw className={loading ? "spin" : ""} />
          </button>
          <button
            className="primary-action"
            onClick={() => setCreateOpen(true)}
            disabled={busy}
          >
            <Plus /> Nova
          </button>
        </div>
      </header>
      <aside className="broadcast-lists">
        <div className="broadcast-list-heading">
          <b>Listas e mensagens</b>
          <span>{lists.length}</span>
        </div>
        {loading && !lists.length ? (
          <div className="list-state">
            <RefreshCw className="spin" /> Carregando…
          </div>
        ) : lists.length ? (
          lists.map((item, index) => (
            <div
              className={`broadcast-list-row ${selectedId === String(item.id) ? "selected" : ""}`}
              key={String(item.id || index)}
            >
              <button onClick={() => void openList(String(item.id))}>
                <span className="broadcast-list-avatar">
                  <UsersRound />
                </span>
                <span>
                  <b>{textOf(item.name, `Lista ${index + 1}`)}</b>
                  <small>
                    {Number(item.contactCount || item.contactsCount || 0)}{" "}
                    destinatário(s)
                    {item.lastMessage ? ` · ${textOf(item.lastMessage)}` : ""}
                  </small>
                </span>
                <em>{textOf(item.lastRunStatus, "")}</em>
              </button>
              {selectedId === String(item.id) && (
                <BroadcastActionMenu
                  label="Opções da lista"
                  items={[
                    {
                      id: "delete-list",
                      label: "Excluir lista",
                      danger: true,
                      onClick: () => void deleteList(),
                    },
                  ]}
                />
              )}
            </div>
          ))
        ) : (
          <div className="list-state">Nenhuma lista criada.</div>
        )}
      </aside>
      <section className="broadcast-conversation">
        <header className="broadcast-conversation-header">
          <button
            type="button"
            className="broadcast-mobile-back"
            aria-label="Voltar às listas"
            onClick={() => {
              setSelectedId(null);
              setDetail(null);
            }}
          >
            <ArrowLeft />
          </button>
          <span className="broadcast-conversation-icon">
            <RadioTower />
          </span>
          <div>
            <h2>{textOf(list.name, "Nova divulgação")}</h2>
            <p>{contacts.length} destinatário(s) · lista de transmissão</p>
          </div>
          <div className="broadcast-conversation-actions">
            <button
              className="secondary-button"
              onClick={() => setContactsOpen(true)}
              disabled={busy}
            >
              <UserPlus /> Destinatários
            </button>
          </div>
        </header>
        <div className="broadcast-message-scroll">
          {loadingDetail ? (
            <div className="module-state">
              <RefreshCw className="spin" />
              <b>Carregando transmissão…</b>
            </div>
          ) : !detail ? (
            <div className="broadcast-welcome">
              <RadioTower />
              <b>Selecione uma lista</b>
              <p>As mensagens e programações aparecerão aqui.</p>
            </div>
          ) : (
            <>
              {schedules.length > 0 && (
                <>
                  <div className="broadcast-section-label">
                    <RadioTower /> Programações <span>{schedules.length}</span>
                  </div>
                  {schedules.slice(0, 12).map((item, index) => {
                    const active =
                      item.enabled !== false &&
                      ["pending", "queued", "running"].includes(
                        textOf(item.status).toLowerCase(),
                      );
                    const nextAt =
                      item.scheduledAt || item.scheduledFor || item.runAt;
                    return (
                      <article
                        className="broadcast-schedule-card"
                        key={String(item.id || index)}
                      >
                        <div className="schedule-card-icon">
                          <RefreshCw />
                        </div>
                        <div className="schedule-card-content">
                          <b>
                            {textOf(
                              item.body || item.message,
                              "Mensagem programada",
                            )}
                          </b>
                          <span>
                            {dateOf(nextAt)}
                            {item.recurrenceMinutes
                              ? ` · a cada ${textOf(item.recurrenceMinutes)} min`
                              : ""}
                          </span>
                          {active && <BroadcastCountdown value={nextAt} />}
                          <small>
                            {active ? "Ativa" : textOf(item.status, "Pausada")}{" "}
                            · delay profissional de transmissão
                          </small>
                        </div>
                        <strong>
                          <span>
                            {Number(item.sent || item.sentTotal || 0)} enviados
                          </span>
                          {Number(item.failed || item.failedTotal || 0) > 0 && (
                            <small>
                              {Number(item.failed || item.failedTotal)} falhas
                            </small>
                          )}
                        </strong>
                        <label
                          className="schedule-toggle"
                          title={
                            active ? "Pausar agendamento" : "Ativar agendamento"
                          }
                        >
                          <input
                            type="checkbox"
                            checked={active}
                            onChange={() => void toggleSchedule(item)}
                            disabled={
                              busy ||
                              textOf(item.status).toLowerCase() === "dispatched"
                            }
                          />
                          <span />
                        </label>
                        <BroadcastActionMenu
                          label="Opções da programação"
                          items={[
                            {
                              id: "progress",
                              label: "Ver progresso",
                              onClick: () =>
                                setProgressRun(
                                  runs.find(
                                    (run) =>
                                      String(run.id || "") ===
                                      String(item.runId || ""),
                                  ) || item,
                                ),
                            },
                            {
                              id: "edit-message",
                              label: "Editar mensagem",
                              onClick: () => setScheduleMessageEdit(item),
                            },
                            {
                              id: "edit",
                              label: "Editar horário e intervalo",
                              onClick: () => setScheduleEdit(item),
                            },
                            {
                              id: "delete",
                              label: "Excluir programação",
                              danger: true,
                              onClick: () => void removeSchedule(item),
                            },
                          ]}
                        />
                      </article>
                    );
                  })}
                </>
              )}
              {messages.length > 0 ? (
                messages.slice(-20).map((item, index) => {
                  const media = mediaFrom(item);
                  const body = textOf(
                    item.body || item.text || item.message,
                    "",
                  );
                  const payload = payloadFrom(item);
                  const buttons = listOf(item, ["buttons"]).length
                    ? listOf(item, ["buttons"])
                    : listOf(payload, ["buttons"]);
                  const kind = textOf(
                    media?.mimeType || media?.mediaType || media?.type,
                  );
                  const mediaUrl = media
                    ? absoluteMediaUrl(
                        textOf(
                          media.url ||
                            media.mediaUrl ||
                            media.path ||
                            media.proxyUrl,
                        ),
                      )
                    : "";
                  return (
                    <article
                      className="broadcast-bubble"
                      key={String(item.id || index)}
                    >
                      {media &&
                        (kind.includes("video") ? (
                          <video
                            className="broadcast-bubble-media"
                            controls
                            preload="metadata"
                            src={mediaUrl}
                          />
                        ) : kind.includes("audio") ? (
                          <audio
                            className="broadcast-bubble-audio"
                            controls
                            preload="metadata"
                            src={mediaUrl}
                          />
                        ) : kind.includes("pdf") ||
                          kind.includes("document") ? (
                          <a
                            className="broadcast-document-preview"
                            href={mediaUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            📄{" "}
                            {textOf(media.fileName || media.name, "Documento")}
                          </a>
                        ) : (
                          <img
                            src={mediaUrl}
                            alt="Mídia da transmissão"
                            onError={(event) => {
                              event.currentTarget.style.display = "none";
                            }}
                          />
                        ))}
                      {body && <p>{body}</p>}
                      {buttons.length > 0 && (
                        <div className="broadcast-native-buttons">
                          {buttons.slice(0, 3).map((button, buttonIndex) => (
                            <button
                              type="button"
                              key={String(button.id || buttonIndex)}
                            >
                              {textOf(
                                button.text || button.title || button.label,
                                "Opção",
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                      <footer>
                        {dateOf(
                          item.createdAt || item.timestamp || item.sentAt,
                        ) || "Agora"}{" "}
                        <span>✓✓</span>
                        <BroadcastActionMenu
                          label="Opções do envio"
                          items={[
                            {
                              id: "progress",
                              label: "Ver progresso",
                              onClick: () =>
                                setProgressRun(
                                  runs.find(
                                    (run) =>
                                      String(run.id || "") ===
                                      String(item.runId || ""),
                                  ) || item,
                                ),
                            },
                            {
                              id: "edit",
                              label: "Editar conteúdo",
                              onClick: () =>
                                setEditorTemplate({
                                  name: "Mensagem reaproveitada",
                                  body,
                                  payload,
                                }),
                            },
                          ]}
                        />
                      </footer>
                    </article>
                  );
                })
              ) : (
                <div className="broadcast-empty-history">
                  <Image />
                  <b>Nenhuma mensagem enviada</b>
                  <p>Selecione uma mensagem para iniciar sua transmissão.</p>
                </div>
              )}
            </>
          )}
        </div>
        <footer className="broadcast-conversation-composer">
          <button onClick={() => setPickerOpen(true)} disabled={!selectedId}>
            <CheckSquare /> Selecionar mensagem
          </button>
        </footer>
      </section>
      {notice && <div className="inline-notice success">{notice}</div>}
      {error && (
        <div className="module-error">
          <b>Não foi possível concluir.</b>
          <span>{error}</span>
          <button onClick={() => setError("")}>Fechar</button>
        </div>
      )}
      {createOpen && (
        <CreateListModal
          busy={busy}
          onClose={() => setCreateOpen(false)}
          onSubmit={(name, description, initialContacts, googleSheetUrl) =>
            void createList(name, description, initialContacts, googleSheetUrl)
          }
        />
      )}
      {pickerOpen && (
        <SavedMessagesModal
          templates={templates}
          selectedId={activeTemplate?.id ? String(activeTemplate.id) : null}
          busy={busy}
          onClose={() => setPickerOpen(false)}
          onSelect={(item) => {
            setPickerOpen(false);
            setActiveTemplate(item);
          }}
          onEdit={(item) => {
            setPickerOpen(false);
            setEditorTemplate(item);
          }}
          onCreate={() => {
            setPickerOpen(false);
            setEditorTemplate(null);
          }}
          onDelete={(templateId) => void deleteTemplate(templateId)}
        />
      )}
      {editorTemplate !== undefined && selectedInstance && selectedId && (
        <BroadcastEditorModal
          key={`edit:${textOf(editorTemplate?.id, "new")}`}
          detail={detail || {}}
          instanceId={selectedInstance}
          listId={selectedId}
          initialBody={textOf(editorTemplate?.body)}
          initialName={textOf(
            editorTemplate?.name,
            editorTemplate ? "Mensagem reaproveitada" : "Nova mensagem",
          )}
          initialMedia={editorTemplate ? mediaFrom(editorTemplate) : null}
          initialPayload={payloadFrom(editorTemplate)}
          initialTemplateId={
            editorTemplate?.id ? String(editorTemplate.id) : null
          }
          editing
          onClose={() => setEditorTemplate(undefined)}
          onSaved={() => {
            setEditorTemplate(undefined);
            setNotice(
              editorTemplate?.id ? "Mensagem atualizada." : "Mensagem criada.",
            );
            void (async () => {
              await openList(selectedId);
              await loadLists();
              setPickerOpen(true);
            })();
          }}
          onError={setError}
        />
      )}
      {activeTemplate && selectedInstance && selectedId && (
        <BroadcastEditorModal
          key={`send:${textOf(activeTemplate.id)}`}
          detail={detail || {}}
          instanceId={selectedInstance}
          listId={selectedId}
          initialBody={textOf(activeTemplate.body)}
          initialName={textOf(activeTemplate.name)}
          initialMedia={mediaFrom(activeTemplate)}
          initialPayload={payloadFrom(activeTemplate)}
          initialTemplateId={
            activeTemplate.id ? String(activeTemplate.id) : null
          }
          editing={false}
          onClose={() => setActiveTemplate(null)}
          onSaved={() => {
            setActiveTemplate(null);
            setNotice("Transmissão atualizada.");
            void openList(selectedId);
            void loadLists();
          }}
          onError={setError}
          onUpdateMentions={updateMentions}
          onEditMessage={() => {
            const current = activeTemplate;
            setActiveTemplate(null);
            setEditorTemplate(current);
          }}
          onChangeMessage={() => {
            setActiveTemplate(null);
            setPickerOpen(true);
          }}
        />
      )}
      {contactsOpen && selectedInstance && selectedId && (
        <BroadcastContactsModal
          instanceId={selectedInstance}
          listId={selectedId}
          current={contacts}
          lists={lists}
          googleSheet={
            detail?.googleSheet && typeof detail.googleSheet === "object"
              ? (detail.googleSheet as JsonRecord)
              : { configured: false }
          }
          onClose={() => setContactsOpen(false)}
          onChanged={() => {
            setNotice("Destinatários atualizados sem duplicação.");
            void openList(selectedId);
            void loadLists();
          }}
          onError={setError}
        />
      )}
      {progressRun && (
        <BroadcastProgressModal
          run={progressRun}
          contacts={runContacts}
          onClose={() => setProgressRun(null)}
        />
      )}
      {scheduleEdit && (
        <BroadcastScheduleModal
          schedule={scheduleEdit}
          busy={busy}
          onClose={() => setScheduleEdit(null)}
          onApply={(payload) => void applyScheduleEdit(payload)}
        />
      )}
      {scheduleMessageEdit && selectedInstance && selectedId && (
        <BroadcastEditorModal
          key={`schedule-message:${textOf(scheduleMessageEdit.id)}`}
          detail={detail || {}}
          instanceId={selectedInstance}
          listId={selectedId}
          initialBody={textOf(scheduleMessageEdit.body)}
          initialName="Mensagem programada"
          initialMedia={mediaFrom(scheduleMessageEdit)}
          initialPayload={payloadFrom(scheduleMessageEdit)}
          editing
          onClose={() => setScheduleMessageEdit(null)}
          onSaved={() => {
            setScheduleMessageEdit(null);
            setNotice("Mensagem da programação atualizada.");
            void openList(selectedId);
          }}
          onError={setError}
          saveButtonLabel="Salvar mensagem programada"
          onSaveContent={(payload) =>
            api.updateBroadcastSchedule(selectedInstance, selectedId, {
              scheduleId: scheduleMessageEdit.id,
              ...payload,
            })
          }
        />
      )}
    </main>
  );
}
