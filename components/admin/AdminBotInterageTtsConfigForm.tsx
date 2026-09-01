"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState, useTransition } from "react";

import type {
  AdminBotInterageTtsAllowedUser,
  AdminBotInterageTtsConfig,
} from "types/botinterage-tts";

type FeedbackState = { type: "success" | "error"; message: string } | null;

type AdminUserSearchResult = {
  id: number;
  name: string;
  email: string | null;
  isActive: boolean;
};

type TtsVoiceSummary = {
  voiceId: string;
  name: string;
  slug: string | null;
  description: string | null;
  tags: string[];
  updatedAtUnix: number | null;
  createdAtUnix: number | null;
};

type TtsVoiceDraft = {
  name: string;
  slug: string;
  description: string;
  tags: string;
  referenceText: string;
};

interface AdminBotInterageTtsConfigFormProps {
  initialConfig: AdminBotInterageTtsConfig;
  initialAllowedUsers: AdminBotInterageTtsAllowedUser[];
  mode?: "all" | "config" | "voices" | "users";
}

const formatTimestamp = (iso?: string | null): string | null => {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo",
    }).format(new Date(iso));
  } catch {
    return null;
  }
};

const AdminBotInterageTtsConfigForm = ({
  initialConfig,
  initialAllowedUsers,
  mode = "all",
}: AdminBotInterageTtsConfigFormProps) => {
  const [config, setConfig] = useState(() => ({
    enabled: initialConfig.enabled,
    baseUrl: initialConfig.baseUrl ?? "https://tts.botadmin.shop",
    token: "",
    clearToken: false,
    defaultVoiceId: initialConfig.defaultVoiceId ?? "",
  }));
  const [persistedConfig, setPersistedConfig] = useState<AdminBotInterageTtsConfig>(initialConfig);
  const [allowedUsers, setAllowedUsers] = useState<AdminBotInterageTtsAllowedUser[]>(initialAllowedUsers);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [searchResults, setSearchResults] = useState<AdminUserSearchResult[]>([]);
  const [pendingUserId, setPendingUserId] = useState<number | null>(null);
  const [voices, setVoices] = useState<TtsVoiceSummary[]>([]);
  const [voiceDrafts, setVoiceDrafts] = useState<Record<string, TtsVoiceDraft>>({});
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [voicePendingId, setVoicePendingId] = useState<string | null>(null);
  const [previewVoiceId, setPreviewVoiceId] = useState<string | null>(null);
  const [previewRequest, setPreviewRequest] = useState<{
    voiceId: string;
    text: string;
    nonce: number;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewText, setPreviewText] = useState("Olá! Esta é uma prévia da voz clonada.");
  const [voiceCreateForm, setVoiceCreateForm] = useState({
    name: "",
    slug: "",
    referenceText: "",
    description: "",
    tags: "",
    file: null as File | null,
  });
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [isPending, startTransition] = useTransition();

  const allowedUserIdSet = useMemo(() => new Set(allowedUsers.map((item) => item.userId)), [allowedUsers]);
  const updatedAtLabel = useMemo(
    () => formatTimestamp(persistedConfig.updatedAt),
    [persistedConfig.updatedAt],
  );
  const previewAudioUrl = useMemo(() => {
    if (!previewRequest) return null;
    const params = new URLSearchParams({
      voiceId: previewRequest.voiceId,
      text: previewRequest.text,
      v: String(previewRequest.nonce),
    });
    return `/api/admin/botinterage-tts/preview?${params.toString()}`;
  }, [previewRequest]);

  const loadVoices = useCallback(async () => {
    if (!persistedConfig.enabled || !persistedConfig.hasToken || !persistedConfig.baseUrl) {
      setVoices([]);
      return;
    }

    setVoicesLoading(true);
    try {
      const response = await fetch("/api/admin/botinterage-tts/voices", {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null) as
        | {
            message?: string;
            voices?: TtsVoiceSummary[];
          }
        | null;
      if (!response.ok) {
        throw new Error(payload?.message ?? "Não foi possível carregar vozes.");
      }
      const nextVoices = Array.isArray(payload?.voices) ? payload!.voices : [];
      setVoices(nextVoices);
      setVoiceDrafts((current) => {
        const next: Record<string, TtsVoiceDraft> = {};
        for (const voice of nextVoices) {
          const existing = current[voice.voiceId];
          next[voice.voiceId] = {
            name: existing?.name ?? voice.name,
            slug: existing?.slug ?? (voice.slug ?? ""),
            description: existing?.description ?? (voice.description ?? ""),
            tags: existing?.tags ?? voice.tags.join(", "),
            referenceText: existing?.referenceText ?? "",
          };
        }
        return next;
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Não foi possível carregar vozes da API TTS.",
      });
    } finally {
      setVoicesLoading(false);
    }
  }, [persistedConfig.baseUrl, persistedConfig.enabled, persistedConfig.hasToken]);

  useEffect(() => {
    void loadVoices();
  }, [loadVoices]);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setSearchingUsers(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setSearchingUsers(true);
      try {
        const params = new URLSearchParams({
          pageSize: "20",
          query: trimmed,
          status: "active",
        });
        const response = await fetch(`/api/admin/users/list?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.message ?? "Não foi possível buscar usuários.");
        }

        const users = Array.isArray(payload?.users) ? payload.users : [];
        setSearchResults(
          users.map((entry: any) => ({
            id: Number(entry.id),
            name: String(entry.name ?? "Usuário"),
            email: typeof entry.email === "string" ? entry.email : null,
            isActive: Boolean(entry.isActive),
          })),
        );
      } catch (error) {
        if (!controller.signal.aborted) {
          setFeedback({
            type: "error",
            message: error instanceof Error ? error.message : "Não foi possível buscar usuários.",
          });
        }
      } finally {
        if (!controller.signal.aborted) {
          setSearchingUsers(false);
        }
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [searchQuery]);

  const handleSaveConfig = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);

    if (config.clearToken && config.token.trim()) {
      setFeedback({
        type: "error",
        message: "Escolha entre limpar o token ou informar um novo token.",
      });
      return;
    }

    startTransition(async () => {
      try {
        const payload: Record<string, unknown> = {
          enabled: config.enabled,
          baseUrl: config.baseUrl.trim(),
          defaultVoiceId: config.defaultVoiceId.trim(),
        };

        if (config.clearToken) {
          payload.clearToken = true;
        } else if (config.token.trim()) {
          payload.token = config.token.trim();
        }

        const response = await fetch("/api/admin/botinterage-tts", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.message ?? "Não foi possível salvar a configuração.");
        }

        if (data?.config) {
          const nextConfig = data.config as AdminBotInterageTtsConfig;
          setPersistedConfig(nextConfig);
          setConfig((current) => ({
            ...current,
            enabled: nextConfig.enabled,
            baseUrl: nextConfig.baseUrl ?? current.baseUrl,
            defaultVoiceId: nextConfig.defaultVoiceId ?? "",
            token: "",
            clearToken: false,
          }));
        }

        await loadVoices();

        setFeedback({
          type: "success",
          message: data?.message ?? "Configuração de TTS do BotInterage atualizada.",
        });
      } catch (error) {
        setFeedback({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "Não foi possível salvar a configuração de TTS do BotInterage.",
        });
      }
    });
  };

  const handleAddUser = async (userId: number) => {
    if (!Number.isFinite(userId) || userId <= 0) return;
    setPendingUserId(userId);
    setFeedback(null);

    try {
      const response = await fetch("/api/admin/botinterage-tts/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.message ?? "Não foi possível liberar este usuário.");
      }
      if (Array.isArray(data?.users)) {
        setAllowedUsers(data.users as AdminBotInterageTtsAllowedUser[]);
      }
      setFeedback({ type: "success", message: data?.message ?? "Usuário liberado com sucesso." });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível liberar este usuário.",
      });
    } finally {
      setPendingUserId(null);
    }
  };

  const handleRemoveUser = async (userId: number) => {
    if (!Number.isFinite(userId) || userId <= 0) return;
    setPendingUserId(userId);
    setFeedback(null);

    try {
      const response = await fetch("/api/admin/botinterage-tts/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.message ?? "Não foi possível remover este usuário.");
      }
      if (Array.isArray(data?.users)) {
        setAllowedUsers(data.users as AdminBotInterageTtsAllowedUser[]);
      }
      setFeedback({ type: "success", message: data?.message ?? "Usuário removido com sucesso." });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível remover este usuário.",
      });
    } finally {
      setPendingUserId(null);
    }
  };

  const handleVoiceFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setVoiceCreateForm((current) => ({ ...current, file }));
  };

  const handleCreateVoice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);

    if (!voiceCreateForm.file) {
      setFeedback({ type: "error", message: "Selecione um áudio de referência para clonar." });
      return;
    }
    if (!voiceCreateForm.referenceText.trim()) {
      setFeedback({
        type: "error",
        message: "Informe o texto exato falado no áudio de referência.",
      });
      return;
    }

    setVoicePendingId("__create__");
    try {
      const form = new FormData();
      form.append("referenceAudio", voiceCreateForm.file);
      form.append("referenceText", voiceCreateForm.referenceText.trim());
      form.append("name", voiceCreateForm.name.trim());
      form.append("slug", voiceCreateForm.slug.trim());
      form.append("description", voiceCreateForm.description.trim());
      form.append("tags", voiceCreateForm.tags.trim());

      const response = await fetch("/api/admin/botinterage-tts/voices", {
        method: "POST",
        body: form,
      });
      const payload = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.message ?? "Não foi possível clonar a voz.");
      }

      setVoiceCreateForm({
        name: "",
        slug: "",
        referenceText: "",
        description: "",
        tags: "",
        file: null,
      });
      setFeedback({ type: "success", message: payload?.message ?? "Voz clonada com sucesso." });
      await loadVoices();
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Não foi possível clonar a voz.",
      });
    } finally {
      setVoicePendingId(null);
    }
  };

  const handleDeleteVoice = async (voiceId: string) => {
    if (!voiceId) return;
    setVoicePendingId(voiceId);
    setFeedback(null);

    try {
      const response = await fetch(`/api/admin/botinterage-tts/voices/${encodeURIComponent(voiceId)}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.message ?? "Não foi possível excluir a voz.");
      }

      if (config.defaultVoiceId === voiceId) {
        setConfig((current) => ({ ...current, defaultVoiceId: "" }));
      }
      if (previewVoiceId === voiceId) {
        setPreviewVoiceId(null);
        setPreviewRequest(null);
        setPreviewLoading(false);
      }

      setFeedback({ type: "success", message: payload?.message ?? "Voz excluída com sucesso." });
      await loadVoices();
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Não foi possível excluir a voz.",
      });
    } finally {
      setVoicePendingId(null);
    }
  };

  const handleVoiceDraftChange = (
    voiceId: string,
    field: keyof TtsVoiceDraft,
    value: string,
  ) => {
    setVoiceDrafts((current) => ({
      ...current,
      [voiceId]: {
        name: current[voiceId]?.name ?? "",
        slug: current[voiceId]?.slug ?? "",
        description: current[voiceId]?.description ?? "",
        tags: current[voiceId]?.tags ?? "",
        referenceText: current[voiceId]?.referenceText ?? "",
        [field]: value,
      },
    }));
  };

  const handleSaveVoice = async (voiceId: string) => {
    const draft = voiceDrafts[voiceId];
    if (!draft) return;

    setVoicePendingId(voiceId);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/botinterage-tts/voices/${encodeURIComponent(voiceId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          slug: draft.slug.trim(),
          description: draft.description.trim(),
          referenceText: draft.referenceText.trim() || undefined,
          tags: draft.tags
            .split(",")
            .map((item) => item.trim())
            .filter((item) => item.length > 0),
        }),
      });
      const payload = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.message ?? "Não foi possível atualizar a voz.");
      }

      setFeedback({ type: "success", message: payload?.message ?? "Voz atualizada com sucesso." });
      await loadVoices();
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Não foi possível atualizar a voz.",
      });
    } finally {
      setVoicePendingId(null);
    }
  };

  const handleSetDefaultVoice = (voiceId: string) => {
    setConfig((current) => ({ ...current, defaultVoiceId: voiceId }));
  };

  const handlePlayPreview = (voiceId: string) => {
    if (!voiceId || !previewText.trim()) {
      setFeedback({
        type: "error",
        message: "Informe o texto da prévia antes de reproduzir.",
      });
      return;
    }
    setPreviewVoiceId(voiceId);
    setPreviewLoading(true);
    setPreviewRequest({
      voiceId,
      text: previewText.trim(),
      nonce: Date.now(),
    });
  };

  return (
    <div className="d-flex flex-column gap-4">
      {(mode === "all" || mode === "config") ? (
      <div className="card">
        <div className="card-header d-flex flex-column flex-md-row justify-content-between gap-2">
          <div>
            <h2 className="h5 mb-1">API Privada de TTS do BotInterage</h2>
            <p className="text-secondary mb-0">
              Configure URL, token e voice_id padrão da API TTS usada nas respostas com áudio.
            </p>
          </div>
          <div className="d-flex flex-column align-items-md-end">
            <span className={`badge ${persistedConfig.enabled ? "bg-success" : "bg-secondary"}`}>
              {persistedConfig.enabled ? "Ativada" : "Desativada"}
            </span>
            <small className="text-secondary mt-2">
              Token: {persistedConfig.hasToken ? "Configurado" : "Pendente"}
            </small>
            {updatedAtLabel ? (
              <small className="text-secondary mt-1">Última atualização: {updatedAtLabel}</small>
            ) : null}
          </div>
        </div>

        <form className="card-body d-flex flex-column gap-4" onSubmit={handleSaveConfig}>
          {feedback ? (
            <div className={`alert ${feedback.type === "success" ? "alert-success" : "alert-danger"} mb-0`} role="alert">
              {feedback.message}
            </div>
          ) : null}

          <div className="form-check form-switch">
            <input
              id="botinterage-tts-enabled"
              className="form-check-input"
              type="checkbox"
              checked={config.enabled}
              onChange={(event) =>
                setConfig((current) => ({ ...current, enabled: event.target.checked }))
              }
            />
            <label htmlFor="botinterage-tts-enabled" className="form-check-label">
              Ativar API privada de TTS do BotInterage
            </label>
          </div>

          <div>
            <label htmlFor="botinterage-tts-base-url" className="form-label">
              URL base da API TTS
            </label>
            <input
              id="botinterage-tts-base-url"
              type="url"
              className="form-control"
              placeholder="https://tts.botadmin.shop"
              value={config.baseUrl}
              onChange={(event) =>
                setConfig((current) => ({ ...current, baseUrl: event.target.value }))
              }
            />
          </div>

          <div>
            <label htmlFor="botinterage-tts-default-voice-id" className="form-label">
              voice_id padrão (opcional)
            </label>
            <select
              id="botinterage-tts-default-voice-id"
              className="form-control"
              value={config.defaultVoiceId}
              onChange={(event) =>
                setConfig((current) => ({ ...current, defaultVoiceId: event.target.value }))
              }
            >
              <option value="">Sem padrão (usar voz escolhida por grupo)</option>
              {voices.map((voice) => (
                <option key={voice.voiceId} value={voice.voiceId}>
                  {voice.name} ({voice.voiceId})
                </option>
              ))}
            </select>
            <div className="form-text">
              {voices.length > 0
                ? "Usado quando o grupo não definir voice_id no modal do Bot Interage."
                : "Clone uma voz abaixo para preencher este seletor automaticamente."}
            </div>
          </div>

          <div className="row g-3 align-items-end">
            <div className="col-md-8">
              <label htmlFor="botinterage-tts-token" className="form-label">
                Novo token (opcional)
              </label>
              <input
                id="botinterage-tts-token"
                type="password"
                className="form-control"
                placeholder={persistedConfig.hasToken ? "Manter token atual" : "Informe o token"}
                value={config.token}
                onChange={(event) =>
                  setConfig((current) => ({ ...current, token: event.target.value, clearToken: false }))
                }
                autoComplete="off"
              />
            </div>
            <div className="col-md-4">
              <div className="form-check mt-3 mt-md-0">
                <input
                  id="botinterage-tts-clear-token"
                  className="form-check-input"
                  type="checkbox"
                  checked={config.clearToken}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      clearToken: event.target.checked,
                      token: "",
                    }))
                  }
                />
                <label htmlFor="botinterage-tts-clear-token" className="form-check-label">
                  Limpar token atual
                </label>
              </div>
            </div>
          </div>

          <div className="d-flex justify-content-end">
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? "Salvando..." : "Salvar configuração"}
            </button>
          </div>
        </form>
      </div>
      ) : null}

      {(mode === "all" || mode === "voices") ? (
      <div className="card">
        <div className="card-header d-flex flex-column flex-md-row justify-content-between gap-2">
          <div>
            <h2 className="h5 mb-1">Gerenciamento de vozes clonadas</h2>
            <p className="text-secondary mb-0">
              Clone novas vozes por upload, selecione padrão, reproduza prévia e exclua sem digitar IDs manualmente.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-outline-primary btn-sm"
            onClick={() => void loadVoices()}
            disabled={voicesLoading || !persistedConfig.enabled || !persistedConfig.hasToken}
          >
            {voicesLoading ? "Sincronizando..." : "Atualizar vozes"}
          </button>
        </div>

        <div className="card-body d-flex flex-column gap-4">
          {!persistedConfig.enabled || !persistedConfig.hasToken ? (
            <div className="alert alert-warning mb-0">
              Ative o TTS privado e salve um token válido para liberar o gerenciamento completo de vozes.
            </div>
          ) : null}

          <form className="border rounded p-3 d-flex flex-column gap-3" onSubmit={handleCreateVoice}>
            <h3 className="h6 mb-0">Clonar nova voz</h3>
            <div className="row g-3">
              <div className="col-md-4">
                <label className="form-label">Nome da voz</label>
                <input
                  type="text"
                  className="form-control"
                  value={voiceCreateForm.name}
                  onChange={(event) =>
                    setVoiceCreateForm((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="Ex.: Niako Feminina"
                />
              </div>
              <div className="col-md-4">
                <label className="form-label">Slug do comando</label>
                <input
                  type="text"
                  className="form-control"
                  value={voiceCreateForm.slug}
                  onChange={(event) =>
                    setVoiceCreateForm((current) => ({ ...current, slug: event.target.value }))
                  }
                  placeholder="Ex.: zoro"
                />
                <div className="form-text">Use depois no grupo: !tts zoro Olá mundo.</div>
              </div>
              <div className="col-md-4">
                <label className="form-label">Tags (opcional)</label>
                <input
                  type="text"
                  className="form-control"
                  value={voiceCreateForm.tags}
                  onChange={(event) =>
                    setVoiceCreateForm((current) => ({ ...current, tags: event.target.value }))
                  }
                  placeholder="pt-br, feminina, anime"
                />
              </div>
              <div className="col-12">
                <label className="form-label">Áudio de referência</label>
                <input
                  type="file"
                  className="form-control"
                  accept="audio/*,video/*,.wav,.mp3,.flac,.ogg,.m4a,.aac,.aiff,.aif,.mp4,.mov,.mkv,.webm,.avi"
                  onChange={handleVoiceFileChange}
                />
                <div className="form-text">
                  Pode enviar MP3/MP4/M4A/WAV e outros formatos: o sistema converte automaticamente quando necessário.
                </div>
              </div>
              <div className="col-12">
                <label className="form-label">Texto exato do áudio de referência</label>
                <textarea
                  className="form-control"
                  rows={3}
                  value={voiceCreateForm.referenceText}
                  onChange={(event) =>
                    setVoiceCreateForm((current) => ({ ...current, referenceText: event.target.value }))
                  }
                  placeholder="Digite exatamente o que está sendo falado no áudio enviado."
                />
              </div>
              <div className="col-12">
                <label className="form-label">Descrição (opcional)</label>
                <textarea
                  className="form-control"
                  rows={2}
                  value={voiceCreateForm.description}
                  onChange={(event) =>
                    setVoiceCreateForm((current) => ({ ...current, description: event.target.value }))
                  }
                  placeholder="Detalhes para identificar melhor essa voz."
                />
              </div>
            </div>
            <div className="d-flex justify-content-end">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={voicePendingId === "__create__" || !persistedConfig.enabled || !persistedConfig.hasToken}
              >
                {voicePendingId === "__create__" ? "Clonando..." : "Clonar voz"}
              </button>
            </div>
          </form>

          <div className="border rounded p-3 d-flex flex-column gap-3">
            <h3 className="h6 mb-0">Prévia de reprodução</h3>
            <div className="row g-3">
              <div className="col-md-8">
                <label className="form-label">Texto da prévia</label>
                <textarea
                  className="form-control"
                  rows={2}
                  value={previewText}
                  onChange={(event) => setPreviewText(event.target.value)}
                />
              </div>
              <div className="col-md-4">
                <label className="form-label">Voz para testar</label>
                <select
                  className="form-control"
                  value={previewVoiceId ?? ""}
                  onChange={(event) => setPreviewVoiceId(event.target.value || null)}
                >
                  <option value="">Selecione...</option>
                  {voices.map((voice) => (
                    <option key={`preview-${voice.voiceId}`} value={voice.voiceId}>
                      {voice.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-outline-primary btn-sm mt-2"
                  onClick={() => (previewVoiceId ? handlePlayPreview(previewVoiceId) : null)}
                  disabled={!previewVoiceId || !previewText.trim() || previewLoading}
                >
                  {previewLoading ? "Gerando..." : "Gerar prévia"}
                </button>
              </div>
            </div>
            {previewLoading ? (
              <small className="text-secondary">Gerando áudio de prévia, aguarde...</small>
            ) : null}
            {previewAudioUrl ? (
              <audio
                key={previewAudioUrl}
                controls
                autoPlay
                src={previewAudioUrl}
                className="w-100"
                onCanPlay={() => setPreviewLoading(false)}
                onLoadedData={() => setPreviewLoading(false)}
                onError={() => {
                  setPreviewLoading(false);
                  setFeedback({
                    type: "error",
                    message: "Falha ao gerar a prévia de áudio. Tente novamente.",
                  });
                }}
              >
                Seu navegador não suporta reprodução de áudio.
              </audio>
            ) : null}
          </div>

          <div>
            <h3 className="h6">Vozes cadastradas ({voices.length})</h3>
            {voicesLoading ? (
              <p className="text-secondary mb-0">Carregando vozes...</p>
            ) : voices.length === 0 ? (
              <p className="text-secondary mb-0">Nenhuma voz clonada encontrada.</p>
            ) : (
              <div className="d-flex flex-column gap-2">
                {voices.map((voice) => (
                  <div
                    key={voice.voiceId}
                    className="d-flex flex-column gap-2 border rounded p-3"
                  >
                    <div className="row g-2">
                      <div className="col-md-6">
                        <label className="form-label small mb-1">Nome</label>
                        <input
                          type="text"
                          className="form-control form-control-sm"
                          value={voiceDrafts[voice.voiceId]?.name ?? voice.name}
                          onChange={(event) =>
                            handleVoiceDraftChange(voice.voiceId, "name", event.target.value)
                          }
                        />
                      </div>
                      <div className="col-md-6">
                        <label className="form-label small mb-1">Slug do comando</label>
                        <input
                          type="text"
                          className="form-control form-control-sm"
                          value={voiceDrafts[voice.voiceId]?.slug ?? (voice.slug ?? "")}
                          onChange={(event) =>
                            handleVoiceDraftChange(voice.voiceId, "slug", event.target.value)
                          }
                          placeholder="zoro"
                        />
                        <div className="form-text small">
                          {voiceDrafts[voice.voiceId]?.slug || voice.slug
                            ? `Use: !tts ${voiceDrafts[voice.voiceId]?.slug || voice.slug} Olá mundo`
                            : "Defina um slug curto para usar no comando !tts."}
                        </div>
                      </div>
                      <div className="col-md-6">
                        <label className="form-label small mb-1">Tags</label>
                        <input
                          type="text"
                          className="form-control form-control-sm"
                          value={voiceDrafts[voice.voiceId]?.tags ?? voice.tags.join(", ")}
                          onChange={(event) =>
                            handleVoiceDraftChange(voice.voiceId, "tags", event.target.value)
                          }
                          placeholder="pt-br, feminina, anime"
                        />
                      </div>
                      <div className="col-12">
                        <label className="form-label small mb-1">Descrição</label>
                        <textarea
                          className="form-control form-control-sm"
                          rows={2}
                          value={voiceDrafts[voice.voiceId]?.description ?? (voice.description ?? "")}
                          onChange={(event) =>
                            handleVoiceDraftChange(voice.voiceId, "description", event.target.value)
                          }
                        />
                      </div>
                      <div className="col-12">
                        <label className="form-label small mb-1">Texto de referência (opcional)</label>
                        <textarea
                          className="form-control form-control-sm"
                          rows={2}
                          value={voiceDrafts[voice.voiceId]?.referenceText ?? ""}
                          onChange={(event) =>
                            handleVoiceDraftChange(voice.voiceId, "referenceText", event.target.value)
                          }
                          placeholder="Só preencha se quiser atualizar o texto de referência salvo."
                        />
                      </div>
                    </div>
                    <div className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-2">
                      <div>
                        <div className="text-secondary small">voice_id: {voice.voiceId}</div>
                        {voice.slug ? (
                          <div className="text-secondary small">slug: {voice.slug}</div>
                        ) : null}
                      </div>
                      <div className="d-flex gap-2">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-success"
                          onClick={() => void handleSaveVoice(voice.voiceId)}
                          disabled={voicePendingId === voice.voiceId}
                        >
                          {voicePendingId === voice.voiceId ? "Salvando..." : "Salvar edição"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary"
                          onClick={() => handleSetDefaultVoice(voice.voiceId)}
                        >
                          {config.defaultVoiceId === voice.voiceId ? "Padrão selecionado" : "Definir padrão"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary"
                          onClick={() => {
                            setPreviewVoiceId(voice.voiceId);
                            handlePlayPreview(voice.voiceId);
                          }}
                          disabled={!previewText.trim() || previewLoading}
                        >
                          Ouvir
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => void handleDeleteVoice(voice.voiceId)}
                          disabled={voicePendingId === voice.voiceId}
                        >
                          {voicePendingId === voice.voiceId ? "Excluindo..." : "Excluir"}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      ) : null}

      {(mode === "all" || mode === "users") ? (
      <div className="card">
        <div className="card-header">
          <h2 className="h5 mb-1">Usuários autorizados no TTS</h2>
          <p className="text-secondary mb-0">
            Somente usuários desta lista poderão ativar respostas em áudio no Bot Interage.
          </p>
        </div>

        <div className="card-body d-flex flex-column gap-4">
          <div>
            <label htmlFor="botinterage-tts-user-search" className="form-label">
              Buscar usuário para liberar
            </label>
            <input
              id="botinterage-tts-user-search"
              type="text"
              className="form-control"
              placeholder="Digite nome ou e-mail"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <div className="form-text">Digite pelo menos 2 caracteres.</div>
          </div>

          <div className="border rounded p-3">
            {searchingUsers ? (
              <p className="text-secondary mb-0">Buscando usuários...</p>
            ) : searchResults.length === 0 ? (
              <p className="text-secondary mb-0">Nenhum usuário encontrado para esta busca.</p>
            ) : (
              <div className="d-flex flex-column gap-2">
                {searchResults.map((user) => {
                  const alreadyAllowed = allowedUserIdSet.has(user.id);
                  return (
                    <div
                      key={user.id}
                      className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-2 border rounded p-2"
                    >
                      <div>
                        <strong>{user.name}</strong>
                        <div className="text-secondary small">{user.email || "Sem e-mail"}</div>
                      </div>
                      <button
                        type="button"
                        className={`btn btn-sm ${alreadyAllowed ? "btn-outline-secondary" : "btn-outline-primary"}`}
                        disabled={alreadyAllowed || pendingUserId === user.id || !user.isActive}
                        onClick={() => void handleAddUser(user.id)}
                      >
                        {alreadyAllowed ? "Já autorizado" : pendingUserId === user.id ? "Adicionando..." : "Autorizar"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <h3 className="h6">Lista atual ({allowedUsers.length})</h3>
            {allowedUsers.length === 0 ? (
              <p className="text-secondary mb-0">Nenhum usuário autorizado no momento.</p>
            ) : (
              <div className="d-flex flex-column gap-2">
                {allowedUsers.map((user) => (
                  <div
                    key={user.userId}
                    className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-2 border rounded p-2"
                  >
                    <div>
                      <strong>{user.name}</strong>
                      <div className="text-secondary small">
                        {user.email || "Sem e-mail"} · {user.isActive ? "Ativo" : "Inativo"}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-danger"
                      onClick={() => void handleRemoveUser(user.userId)}
                      disabled={pendingUserId === user.userId}
                    >
                      {pendingUserId === user.userId ? "Removendo..." : "Remover"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      ) : null}
    </div>
  );
};

export default AdminBotInterageTtsConfigForm;
