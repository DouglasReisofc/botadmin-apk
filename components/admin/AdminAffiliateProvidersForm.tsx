"use client";

import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState, useTransition } from "react";

import type { AdminAffiliateProviderSettings } from "types/admin-affiliates";

type FeedbackState = { type: "success" | "error"; message: string } | null;

type FormState = {
  enabled: boolean;
  appId: string;
  clientSecret: string;
  appToken: string;
  authEndpoint: string;
  tokenEndpoint: string;
  redirectUri: string;
  scopeText: string;
  extractorCookieText: string;
};

const toFormState = (provider: AdminAffiliateProviderSettings): FormState => ({
  enabled: provider.enabled,
  appId: provider.appId ?? "",
  clientSecret: provider.clientSecret ?? "",
  appToken: provider.appToken ?? "",
  authEndpoint: provider.authEndpoint ?? "",
  tokenEndpoint: provider.tokenEndpoint ?? "",
  redirectUri: provider.redirectUri ?? "",
  scopeText: provider.scopeText ?? "",
  extractorCookieText: provider.extractorCookieText ?? "",
});

const formatTimestamp = (value?: string | null): string | null => {
  if (!value) return null;
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo",
    }).format(new Date(value));
  } catch {
    return null;
  }
};

interface AdminAffiliateProvidersFormProps {
  initialProviders: AdminAffiliateProviderSettings[];
}

const AdminAffiliateProvidersForm = ({ initialProviders }: AdminAffiliateProvidersFormProps) => {
  const [providers, setProviders] = useState<AdminAffiliateProviderSettings[]>(initialProviders);
  const [selectedProviderKey, setSelectedProviderKey] = useState<string>(initialProviders[0]?.provider ?? "mercadolivre");
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [formState, setFormState] = useState<FormState>(() =>
    initialProviders[0] ? toFormState(initialProviders[0]) : {
      enabled: false,
      appId: "",
      clientSecret: "",
      appToken: "",
      authEndpoint: "",
      tokenEndpoint: "",
      redirectUri: "",
      scopeText: "",
      extractorCookieText: "",
    });
  const [isPending, startTransition] = useTransition();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const selectedProvider = useMemo(
    () =>
      providers.find((provider) => provider.provider === selectedProviderKey) ??
      providers[0] ??
      null,
    [providers, selectedProviderKey],
  );

  useEffect(() => {
    if (!selectedProvider) {
      return;
    }
    setFormState(toFormState(selectedProvider));
  }, [selectedProvider]);

  const selectedStatusLabel = useMemo(() => {
    if (!selectedProvider) return "Sem provedor";
    if (!selectedProvider.implemented) return "Em breve";
    if (selectedProvider.runtimeEnabled) return "Ativo";
    return selectedProvider.enabled ? "Config. incompleta" : "Desativado";
  }, [selectedProvider]);

  const selectedStatusBadge = useMemo(() => {
    if (!selectedProvider) return "bg-secondary";
    if (!selectedProvider.implemented) return "bg-warning text-dark";
    if (selectedProvider.runtimeEnabled) return "bg-success";
    return selectedProvider.enabled ? "bg-info text-dark" : "bg-secondary";
  }, [selectedProvider]);

  const refreshProviders = async () => {
    setIsRefreshing(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/admin/affiliates/providers", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message || "Nao foi possivel atualizar a lista de provedores.");
      }
      const nextProviders = Array.isArray(payload?.providers)
        ? (payload.providers as AdminAffiliateProviderSettings[])
        : [];
      setProviders(nextProviders);
      if (nextProviders.length > 0 && !nextProviders.some((item) => item.provider === selectedProviderKey)) {
        setSelectedProviderKey(nextProviders[0].provider);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nao foi possivel atualizar os provedores.";
      setFeedback({ type: "error", message });
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedProvider) {
      setFeedback({ type: "error", message: "Selecione um provedor para salvar." });
      return;
    }

    setFeedback(null);
    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/admin/affiliates/providers/${encodeURIComponent(selectedProvider.provider)}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              enabled: formState.enabled,
              appId: formState.appId,
              clientSecret: formState.clientSecret,
              appToken: formState.appToken,
              authEndpoint: formState.authEndpoint,
              tokenEndpoint: formState.tokenEndpoint,
              redirectUri: formState.redirectUri,
              scopeText: formState.scopeText,
              extractorCookieText: formState.extractorCookieText,
            }),
          },
        );

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.message || "Nao foi possivel salvar o provedor.");
        }

        const updatedProvider = payload?.provider as AdminAffiliateProviderSettings | undefined;
        if (updatedProvider) {
          setProviders((current) =>
            current.map((provider) =>
              provider.provider === updatedProvider.provider ? updatedProvider : provider,
            ),
          );
          setFormState(toFormState(updatedProvider));
        }

        setFeedback({
          type: "success",
          message: payload?.message || "Configuracao atualizada com sucesso.",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Nao foi possivel salvar.";
        setFeedback({ type: "error", message });
      }
    });
  };

  const handleCookieFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      setFormState((current) => ({ ...current, extractorCookieText: text }));
      setFeedback({
        type: "success",
        message: `Cookie da Shopee carregado do arquivo ${file.name}. Salve para aplicar no extrator.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nao foi possivel ler o arquivo de cookie.";
      setFeedback({ type: "error", message });
    }
  };

  return (
    <div className="card">
      <div className="card-header d-flex flex-column flex-lg-row justify-content-between gap-3">
        <div>
          <h2 className="h5 mb-1">Provedores de afiliados</h2>
          <p className="text-secondary mb-0">
            Ative ou desative os provedores disponiveis e centralize app id, token e credenciais OAuth de cada plataforma.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-outline-secondary align-self-start"
          onClick={() => void refreshProviders()}
          disabled={isRefreshing || isPending}
        >
          {isRefreshing ? "Atualizando..." : "Atualizar lista"}
        </button>
      </div>

      <div className="card-body">
        {feedback ? (
          <div className={`alert ${feedback.type === "success" ? "alert-success" : "alert-danger"} mb-4`} role="alert">
            {feedback.message}
          </div>
        ) : null}

        <div className="row g-4">
          <div className="col-lg-4">
            <div className="list-group">
              {providers.map((provider) => {
                const active = selectedProvider?.provider === provider.provider;
                const statusLabel = !provider.implemented
                  ? "Em breve"
                  : provider.runtimeEnabled
                    ? "Ativo"
                    : provider.enabled
                      ? "Config. incompleta"
                      : "Desativado";
                const statusBadge = !provider.implemented
                  ? "bg-warning text-dark"
                  : provider.runtimeEnabled
                    ? "bg-success"
                    : provider.enabled
                      ? "bg-info text-dark"
                      : "bg-secondary";
                return (
                  <button
                    key={provider.provider}
                    type="button"
                    className={`list-group-item list-group-item-action ${active ? "active" : ""}`}
                    onClick={() => setSelectedProviderKey(provider.provider)}
                  >
                    <div className="d-flex align-items-center gap-3">
                      {provider.logoUrl ? (
                        <img
                          src={provider.logoUrl}
                          alt={`Logo ${provider.label}`}
                          width={38}
                          height={38}
                          className="rounded-circle border"
                        />
                      ) : (
                        <div
                          className="rounded-circle border d-flex align-items-center justify-content-center"
                          style={{ width: 38, height: 38 }}
                        >
                          {provider.label.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="flex-grow-1 text-start">
                        <strong className="d-block">{provider.label}</strong>
                        <small className={active ? "text-light" : "text-secondary"}>{provider.description}</small>
                      </div>
                      <span className={`badge ${statusBadge}`}>{statusLabel}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="col-lg-8">
            {selectedProvider ? (
              <form className="d-flex flex-column gap-3" onSubmit={handleSubmit}>
                <div className="d-flex flex-wrap align-items-center gap-2">
                  <h3 className="h5 mb-0">{selectedProvider.label}</h3>
                  <span className={`badge ${selectedStatusBadge}`}>{selectedStatusLabel}</span>
                  {selectedProvider.updatedAt ? (
                    <small className="text-secondary">
                      Ultima alteracao: {formatTimestamp(selectedProvider.updatedAt)}
                    </small>
                  ) : null}
                </div>

                <div className="form-check form-switch">
                  <input
                    id="provider-enabled"
                    className="form-check-input"
                    type="checkbox"
                    checked={formState.enabled}
                    onChange={(event) =>
                      setFormState((current) => ({ ...current, enabled: event.target.checked }))
                    }
                    disabled={isPending}
                  />
                  <label className="form-check-label" htmlFor="provider-enabled">
                    Ativar provedor para usuarios
                  </label>
                  <div className="form-text">
                    Se desativado, o provedor fica com status "Em breve" para os usuarios.
                  </div>
                </div>
                {selectedProvider.enabled && !selectedProvider.runtimeEnabled && selectedProvider.implemented ? (
                  <div className="alert alert-info mb-0" role="alert">
                    O provedor esta ligado, mas ainda nao esta operacional. Revise app id, secret, endpoints e redirect URI.
                  </div>
                ) : null}

                <div className="row g-3">
                  <div className="col-md-6">
                    <label htmlFor="provider-app-id" className="form-label">App ID / Client ID</label>
                    <input
                      id="provider-app-id"
                      type="text"
                      className="form-control"
                      value={formState.appId}
                      onChange={(event) =>
                        setFormState((current) => ({ ...current, appId: event.target.value }))
                      }
                      placeholder="Ex.: 7481286147495073"
                      disabled={isPending}
                    />
                  </div>
                  <div className="col-md-6">
                    <label htmlFor="provider-client-secret" className="form-label">Client secret</label>
                    <input
                      id="provider-client-secret"
                      type="text"
                      className="form-control"
                      value={formState.clientSecret}
                      onChange={(event) =>
                        setFormState((current) => ({ ...current, clientSecret: event.target.value }))
                      }
                      placeholder="Segredo da aplicacao"
                      disabled={isPending}
                    />
                  </div>
                  <div className="col-md-6">
                    <label htmlFor="provider-app-token" className="form-label">Token da aplicacao (opcional)</label>
                    <input
                      id="provider-app-token"
                      type="text"
                      className="form-control"
                      value={formState.appToken}
                      onChange={(event) =>
                        setFormState((current) => ({ ...current, appToken: event.target.value }))
                      }
                      placeholder="Token global para APIs futuras"
                      disabled={isPending}
                    />
                  </div>
                  <div className="col-md-6">
                    <label htmlFor="provider-redirect" className="form-label">Redirect URI</label>
                    <input
                      id="provider-redirect"
                      type="url"
                      className="form-control"
                      value={formState.redirectUri}
                      onChange={(event) =>
                        setFormState((current) => ({ ...current, redirectUri: event.target.value }))
                      }
                      placeholder="https://botadmin.shop/webhook/ml"
                      disabled={isPending}
                    />
                  </div>
                  <div className="col-md-6">
                    <label htmlFor="provider-auth-endpoint" className="form-label">OAuth auth endpoint</label>
                    <input
                      id="provider-auth-endpoint"
                      type="url"
                      className="form-control"
                      value={formState.authEndpoint}
                      onChange={(event) =>
                        setFormState((current) => ({ ...current, authEndpoint: event.target.value }))
                      }
                      placeholder="https://auth...."
                      disabled={isPending}
                    />
                  </div>
                  <div className="col-md-6">
                    <label htmlFor="provider-token-endpoint" className="form-label">OAuth token endpoint</label>
                    <input
                      id="provider-token-endpoint"
                      type="url"
                      className="form-control"
                      value={formState.tokenEndpoint}
                      onChange={(event) =>
                        setFormState((current) => ({ ...current, tokenEndpoint: event.target.value }))
                      }
                      placeholder="https://api...."
                      disabled={isPending}
                    />
                  </div>
                  <div className="col-12">
                    <label htmlFor="provider-scopes" className="form-label">Escopos padrao OAuth</label>
                    <textarea
                      id="provider-scopes"
                      className="form-control"
                      rows={3}
                      value={formState.scopeText}
                      onChange={(event) =>
                        setFormState((current) => ({ ...current, scopeText: event.target.value }))
                      }
                      placeholder="items.read orders.read ..."
                      disabled={isPending}
                    />
                    <div className="form-text">
                      Separe por espaco, virgula ou quebra de linha. Campos acima ficam salvos por provedor.
                    </div>
                  </div>
                  {selectedProvider.provider === "shopee" ? (
                    <div className="col-12">
                      <label htmlFor="provider-shopee-cookie" className="form-label">Cookie global do extrator Shopee</label>
                      <textarea
                        id="provider-shopee-cookie"
                        className="form-control"
                        rows={8}
                        value={formState.extractorCookieText}
                        onChange={(event) =>
                          setFormState((current) => ({ ...current, extractorCookieText: event.target.value }))
                        }
                        placeholder={"Cole o Cookie header ou o conteudo completo do cookies.txt da Shopee.\nO extrator HTTP vai usar esse cookie para resolver video original e produtos vinculados."}
                        disabled={isPending}
                      />
                      <div className="d-flex flex-column flex-md-row gap-2 mt-2">
                        <input
                          id="provider-shopee-cookie-file"
                          type="file"
                          className="form-control"
                          accept=".txt,text/plain"
                          onChange={(event) => void handleCookieFileChange(event)}
                          disabled={isPending}
                        />
                        <button
                          type="button"
                          className="btn btn-outline-secondary"
                          onClick={() => setFormState((current) => ({ ...current, extractorCookieText: "" }))}
                          disabled={isPending || formState.extractorCookieText.trim().length === 0}
                        >
                          Limpar cookie
                        </button>
                      </div>
                      <div className="form-text">
                        Esse cookie e global. O bot usa ele para capturar video em HD, legenda e produtos do Shopee sem depender de navegador em runtime.
                      </div>
                    </div>
                  ) : null}
                </div>

                {!selectedProvider.implemented ? (
                  <div className="alert alert-warning mb-0" role="alert">
                    Este provedor esta marcado como "Em breve". As credenciais podem ser preparadas agora e ativadas quando a integracao for implementada.
                  </div>
                ) : null}

                <div className="d-flex justify-content-end">
                  <button type="submit" className="btn btn-primary" disabled={isPending}>
                    {isPending ? "Salvando..." : "Salvar configuracao"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="alert alert-secondary mb-0" role="alert">
                Nenhum provedor encontrado.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminAffiliateProvidersForm;
