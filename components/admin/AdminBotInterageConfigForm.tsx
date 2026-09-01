"use client";

import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";

import type {
  AdminBotInterageAllowedUser,
  AdminBotInterageConfig,
} from "types/botinterage";

type FeedbackState = { type: "success" | "error"; message: string } | null;

type AdminUserSearchResult = {
  id: number;
  name: string;
  email: string | null;
  isActive: boolean;
};

interface AdminBotInterageConfigFormProps {
  initialConfig: AdminBotInterageConfig;
  initialAllowedUsers: AdminBotInterageAllowedUser[];
  mode?: "all" | "config" | "users";
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

const AdminBotInterageConfigForm = ({
  initialConfig,
  initialAllowedUsers,
  mode = "all",
}: AdminBotInterageConfigFormProps) => {
  const [config, setConfig] = useState(() => ({
    enabled: initialConfig.enabled,
    baseUrl: initialConfig.baseUrl ?? "https://filesvip.shop/llm-api",
    token: "",
    clearToken: false,
    model: initialConfig.model || "qwen2.5:7b",
  }));
  const [persistedConfig, setPersistedConfig] = useState<AdminBotInterageConfig>(initialConfig);
  const [allowedUsers, setAllowedUsers] = useState<AdminBotInterageAllowedUser[]>(initialAllowedUsers);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [searchResults, setSearchResults] = useState<AdminUserSearchResult[]>([]);
  const [pendingUserId, setPendingUserId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [isPending, startTransition] = useTransition();

  const allowedUserIdSet = useMemo(() => new Set(allowedUsers.map((item) => item.userId)), [allowedUsers]);
  const updatedAtLabel = useMemo(
    () => formatTimestamp(persistedConfig.updatedAt),
    [persistedConfig.updatedAt],
  );

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
          model: config.model.trim() || "qwen2.5:7b",
        };

        if (config.clearToken) {
          payload.clearToken = true;
        } else if (config.token.trim()) {
          payload.token = config.token.trim();
        }

        const response = await fetch("/api/admin/botinterage", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.message ?? "Não foi possível salvar a configuração.");
        }

        if (data?.config) {
          const nextConfig = data.config as AdminBotInterageConfig;
          setPersistedConfig(nextConfig);
          setConfig((current) => ({
            ...current,
            enabled: nextConfig.enabled,
            baseUrl: nextConfig.baseUrl ?? current.baseUrl,
            model: nextConfig.model || "qwen2.5:7b",
            token: "",
            clearToken: false,
          }));
        }

        setFeedback({
          type: "success",
          message: data?.message ?? "Configuração do BotInterage atualizada.",
        });
      } catch (error) {
        setFeedback({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "Não foi possível salvar a configuração do BotInterage.",
        });
      }
    });
  };

  const handleAddUser = async (userId: number) => {
    if (!Number.isFinite(userId) || userId <= 0) return;
    setPendingUserId(userId);
    setFeedback(null);

    try {
      const response = await fetch("/api/admin/botinterage/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.message ?? "Não foi possível liberar este usuário.");
      }
      if (Array.isArray(data?.users)) {
        setAllowedUsers(data.users as AdminBotInterageAllowedUser[]);
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
      const response = await fetch("/api/admin/botinterage/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.message ?? "Não foi possível remover este usuário.");
      }
      if (Array.isArray(data?.users)) {
        setAllowedUsers(data.users as AdminBotInterageAllowedUser[]);
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

  return (
    <div className="d-flex flex-column gap-4">
      {(mode === "all" || mode === "config") ? (
      <div className="card">
        <div className="card-header d-flex flex-column flex-md-row justify-content-between gap-2">
          <div>
            <h2 className="h5 mb-1">API Privada do BotInterage</h2>
            <p className="text-secondary mb-0">
              Configure URL, token e modelo da API privada usada pelo Bot Interage.
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
              id="botinterage-enabled"
              className="form-check-input"
              type="checkbox"
              checked={config.enabled}
              onChange={(event) =>
                setConfig((current) => ({ ...current, enabled: event.target.checked }))
              }
            />
            <label htmlFor="botinterage-enabled" className="form-check-label">
              Ativar API privada do BotInterage
            </label>
          </div>

          <div>
            <label htmlFor="botinterage-base-url" className="form-label">
              URL base da API
            </label>
            <input
              id="botinterage-base-url"
              type="url"
              className="form-control"
              placeholder="https://filesvip.shop/llm-api"
              value={config.baseUrl}
              onChange={(event) =>
                setConfig((current) => ({ ...current, baseUrl: event.target.value }))
              }
            />
          </div>

          <div>
            <label htmlFor="botinterage-model" className="form-label">
              Modelo padrão
            </label>
            <input
              id="botinterage-model"
              type="text"
              className="form-control"
              placeholder="qwen2.5:7b"
              value={config.model}
              onChange={(event) =>
                setConfig((current) => ({ ...current, model: event.target.value }))
              }
            />
          </div>

          <div className="row g-3 align-items-end">
            <div className="col-md-8">
              <label htmlFor="botinterage-token" className="form-label">
                Novo token (opcional)
              </label>
              <input
                id="botinterage-token"
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
                  id="botinterage-clear-token"
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
                <label htmlFor="botinterage-clear-token" className="form-check-label">
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

      {(mode === "all" || mode === "users") ? (
      <div className="card">
        <div className="card-header">
          <h2 className="h5 mb-1">Usuários autorizados</h2>
          <p className="text-secondary mb-0">
            Somente usuários desta lista poderão ver e ativar o Bot Interage no painel de grupos.
          </p>
        </div>

        <div className="card-body d-flex flex-column gap-4">
          <div>
            <label htmlFor="botinterage-user-search" className="form-label">
              Buscar usuário para liberar
            </label>
            <input
              id="botinterage-user-search"
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

export default AdminBotInterageConfigForm;
