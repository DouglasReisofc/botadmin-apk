"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";

import type { MegaCredentials } from "types/mega";

type FeedbackState = { type: "success" | "error"; message: string } | null;

interface AdminMegaCredentialsFormProps {
  initialCredentials: MegaCredentials;
}

const formatTimestamp = (iso?: string | null): string | null => {
  if (!iso) {
    return null;
  }

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

const AdminMegaCredentialsForm = ({ initialCredentials }: AdminMegaCredentialsFormProps) => {
  const [formState, setFormState] = useState(() => ({
    email: initialCredentials.email ?? "",
    password: "",
    clearPassword: false,
    externalAccountsEnabled: initialCredentials.externalAccountsEnabled,
    externalAccountsUrl: initialCredentials.externalAccountsUrl ?? "",
    resetSession: false,
  }));
  const [persisted, setPersisted] = useState<MegaCredentials>(initialCredentials);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [isPending, startTransition] = useTransition();

  const statusLabel = persisted.hasPassword ? "Configurada" : "Pendente";
  const statusClass = persisted.hasPassword ? "bg-success" : "bg-warning text-dark";
  const updatedAtLabel = useMemo(
    () => formatTimestamp(persisted.updatedAt),
    [persisted.updatedAt],
  );
  const sessionUpdatedAtLabel = useMemo(
    () => formatTimestamp(persisted.sessionUpdatedAt),
    [persisted.sessionUpdatedAt],
  );
  const sessionStatusLabel = persisted.hasSession
    ? `Ativa${persisted.sessionEmail ? ` (${persisted.sessionEmail})` : ""}`
    : "Não configurada";

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);

    if (formState.clearPassword && formState.password.trim()) {
      setFeedback({
        type: "error",
        message: "Escolha entre limpar a senha ou informar uma nova senha.",
      });
      return;
    }

    startTransition(async () => {
      try {
        const payload: Record<string, unknown> = {};
        const email = formState.email.trim();
        if (email) {
          payload.email = email;
        } else {
          payload.email = null;
        }

        if (formState.clearPassword) {
          payload.clearPassword = true;
        } else if (formState.password.trim()) {
          payload.password = formState.password.trim();
        }

        payload.externalAccountsEnabled = formState.externalAccountsEnabled;
        const endpoint = formState.externalAccountsUrl.trim();
        payload.externalAccountsUrl = endpoint ? endpoint : null;

        if (formState.resetSession) {
          payload.resetSession = true;
        }

        const response = await fetch("/api/admin/mega", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.message || "Não foi possível salvar as credenciais.");
        }

        const credentials = data?.credentials as MegaCredentials | undefined;
        if (credentials) {
          setPersisted(credentials);
          setFormState({
            email: credentials.email ?? "",
            password: "",
            clearPassword: false,
            externalAccountsEnabled: credentials.externalAccountsEnabled,
            externalAccountsUrl: credentials.externalAccountsUrl ?? "",
            resetSession: false,
          });
        }

        setFeedback({
          type: "success",
          message: data?.message || "Credenciais atualizadas com sucesso.",
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Não foi possível salvar as credenciais.";
        setFeedback({ type: "error", message });
      }
    });
  };

  return (
    <div className="card">
      <div className="card-header d-flex flex-column flex-md-row justify-content-between gap-2">
        <div>
          <h2 className="h5 mb-1">Credenciais do Mega</h2>
          <p className="text-secondary mb-0">
            Informe o e-mail e a senha da conta Mega.NZ utilizada para baixar arquivos
            automaticamente. Manter as credenciais atualizadas garante que o bot consiga acessar os
            arquivos compartilhados.
          </p>
        </div>
        <div className="d-flex flex-column align-items-md-end">
          <span className={`badge ${statusClass} align-self-start align-self-md-end`}>
            {statusLabel}
          </span>
          {updatedAtLabel ? (
            <small className="text-secondary mt-2">
              Última atualização: {updatedAtLabel}
            </small>
          ) : null}
          <small className="text-secondary mt-1">
            Sessão: {sessionStatusLabel}
            {sessionUpdatedAtLabel ? ` — ${sessionUpdatedAtLabel}` : ""}
          </small>
        </div>
      </div>

      <form className="card-body d-flex flex-column gap-4" onSubmit={handleSubmit}>
        {feedback ? (
          <div
            className={`alert ${
              feedback.type === "success" ? "alert-success" : "alert-danger"
            } mb-0`}
            role="alert"
          >
            {feedback.message}
          </div>
        ) : null}

        <div>
          <label htmlFor="mega-email" className="form-label">
            E-mail do Mega
          </label>
          <input
            id="mega-email"
            type="email"
            className="form-control"
            placeholder="exemplo@seuemail.com"
            value={formState.email}
            onChange={(event) =>
              setFormState((current) => ({ ...current, email: event.target.value }))
            }
            autoComplete="email"
          />
          <div className="form-text">
            Utilize a mesma conta configurada para os links do autodownloader. É recomendado usar
            uma conta dedicada.
          </div>
        </div>

        <div className="row g-3 align-items-end">
          <div className="col-md-7">
            <label htmlFor="mega-password" className="form-label">
              Nova senha
            </label>
            <input
              id="mega-password"
              type="password"
              className="form-control"
              placeholder={persisted.hasPassword ? "Manter senha atual" : "Informe a senha do Mega"}
              value={formState.password}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  password: event.target.value,
                  clearPassword: false,
                }))
              }
              autoComplete="new-password"
            />
            <div className="form-text">
              Informe uma nova senha para atualizar o acesso. Deixe em branco para manter a senha
              atual.
            </div>
          </div>

          <div className="col-md-5">
            <div className="form-check mt-3 mt-md-0">
              <input
                id="mega-clear-password"
                className="form-check-input"
                type="checkbox"
                checked={formState.clearPassword}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    clearPassword: event.target.checked,
                    password: "",
                  }))
                }
              />
              <label htmlFor="mega-clear-password" className="form-check-label">
                Limpar senha armazenada
              </label>
            </div>
            <div className="form-text">
              Se marcado, remove a senha atual após salvar. O autodownloader ficará indisponível até
              cadastrar novamente.
            </div>
          </div>
        </div>

        <div className="card border rounded p-3">
          <div className="form-check form-switch mb-3">
            <input
              id="mega-external-enabled"
              className="form-check-input"
              type="checkbox"
              checked={formState.externalAccountsEnabled}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  externalAccountsEnabled: event.target.checked,
                }))
              }
            />
            <label className="form-check-label" htmlFor="mega-external-enabled">
              Usar contas externas automaticamente
            </label>
            <div className="form-text">
              Quando ativo, o bot consulta o endpoint abaixo e utiliza a primeira conta válida
              disponível. As credenciais manuais permanecem como fallback.
            </div>
          </div>

          <label htmlFor="mega-external-url" className="form-label">
            Endpoint com contas do Mega
          </label>
          <input
            id="mega-external-url"
            type="url"
            className="form-control"
            placeholder="https://exemplo.com/api/accounts"
            value={formState.externalAccountsUrl}
            onChange={(event) =>
              setFormState((current) => ({
                ...current,
                externalAccountsUrl: event.target.value,
              }))
            }
          />
          <div className="form-text">
            Informe um endpoint que retorne uma lista JSON com <code>{'{ email, password, status }'}</code>.
            Apenas contas com status &quot;valid&quot; serão utilizadas.
          </div>
        </div>

        <div className="form-check">
          <input
            id="mega-reset-session"
            className="form-check-input"
            type="checkbox"
            checked={formState.resetSession}
            onChange={(event) =>
              setFormState((current) => ({
                ...current,
                resetSession: event.target.checked,
              }))
            }
          />
          <label htmlFor="mega-reset-session" className="form-check-label">
            Limpar sessão salva e forçar novo login
          </label>
          <div className="form-text">
            Use esta opção se notar erros de autenticação ou troca de contas. O próximo download
            fará login novamente antes de baixar arquivos.
          </div>
        </div>

        <div className="d-flex justify-content-end">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isPending}
          >
            {isPending ? "Salvando..." : "Salvar credenciais"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default AdminMegaCredentialsForm;
