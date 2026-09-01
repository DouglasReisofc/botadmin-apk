"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Modal } from "react-bootstrap";

import type { PlanCheckoutResponse } from "types/plans";
import type { PaymentMethodProvider, PaymentMethodSummary } from "types/payments";

type ApiParam = {
  name: string;
  description: string;
  required?: boolean;
};

export type ApiEndpoint = {
  name: string;
  method: string;
  path: string;
  description: string;
  queryParams?: ApiParam[];
  notes?: string[];
  sampleQuery?: Record<string, string>;
  sampleBody?: Record<string, unknown> | string;
  shortName?: string;
};

export type ApiEndpointSection = {
  title: string;
  description?: string;
  endpoints: ApiEndpoint[];
};

export type ApiKeySnapshot = {
  apiKey: string;
  dailyQuota: number;
  requestsUsed: number;
  remaining: number;
  resetAt: string | null;
  updatedAt: string;
};

type ApiRequestPlanSummary = {
  id: number;
  name: string;
  description: string | null;
  priceCents: number;
  requestAmount: number;
  isActive?: boolean;
  orderIndex?: number;
};

type Feedback = {
  type: "success" | "error";
  message: string;
} | null;

type ActionState = "rotate" | "custom" | null;

type ProviderOption = {
  provider: PaymentMethodProvider;
  label: string;
};

type Props = {
  initialSnapshot: ApiKeySnapshot;
  sections: ApiEndpointSection[];
  baseUrl: string;
  plans: ApiRequestPlanSummary[];
  paymentMethods: PaymentMethodSummary[];
};

const PROVIDER_FALLBACK_LABELS: Record<PaymentMethodProvider, string> = {
  mercadopago_pix: "Pix (Mercado Pago)",
  polopag_pix: "Pix (PoloPag)",
  mercadopago_checkout: "Checkout Mercado Pago",
};

const SUPPORTED_PROVIDERS: readonly PaymentMethodProvider[] = [
  "mercadopago_pix",
  "polopag_pix",
  "mercadopago_checkout",
];

const formatDateTime = (value: string | null): string => {
  if (!value) {
    return "—";
  }
  try {
    return new Date(value).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
    });
  } catch {
    return value;
  }
};

const normalizeSnapshot = (payload: any): ApiKeySnapshot => ({
  apiKey: String(payload.apiKey ?? ""),
  dailyQuota: Number(payload.dailyQuota ?? 0),
  requestsUsed: Number(payload.requestsUsed ?? 0),
  remaining: Number(payload.remaining ?? 0),
  resetAt: typeof payload.resetAt === "string" ? payload.resetAt : null,
  updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : new Date().toISOString(),
});

const buildSampleUrl = (baseUrl: string, endpoint: ApiEndpoint, apiKey: string): string => {
  const url = new URL(endpoint.path.replace(/^\//, ""), `${baseUrl.replace(/\/$/, "")}/`);
  if (endpoint.sampleQuery) {
    Object.entries(endpoint.sampleQuery).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }
  if (!url.searchParams.has("apikey")) {
    url.searchParams.set("apikey", apiKey || "SUA_CHAVE");
  }
  return url.toString();
};

const formatCurrencyFromCents = (value: number): string =>
  (Math.max(0, value) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatCurrency = (value: number): string =>
  Math.max(0, value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatInteger = (value: number): string =>
  Math.max(0, Math.floor(value)).toLocaleString("pt-BR");

const getEndpointShortName = (endpoint: ApiEndpoint): string => {
  if (endpoint.shortName) {
    return endpoint.shortName;
  }
  const segments = endpoint.path.split("/").filter(Boolean);
  if (segments.length === 0) {
    return endpoint.name || endpoint.path || "endpoint";
  }
  const lastSegment = segments[segments.length - 1];
  return lastSegment || endpoint.name || endpoint.path || "endpoint";
};

const buildEndpointUrl = (
  baseUrl: string,
  endpoint: ApiEndpoint,
  query: Record<string, string>,
  apiKey: string | null | undefined,
): URL => {
  const url = new URL(endpoint.path.replace(/^\//, ""), `${baseUrl.replace(/\/$/, "")}/`);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      url.searchParams.set(key, value);
    }
  });
  if (apiKey && !url.searchParams.has("apikey")) {
    url.searchParams.set("apikey", apiKey);
  }
  return url;
};

const buildCurlCommand = (
  baseUrl: string,
  endpoint: ApiEndpoint,
  query: Record<string, string>,
  apiKey: string | null | undefined,
  body?: string,
): string => {
  const url = buildEndpointUrl(baseUrl, endpoint, query, apiKey).toString();
  const method = (endpoint.method || "GET").toUpperCase();
  const parts = [`curl -X ${method}`, `"${url}"`];
  if (body && body.trim()) {
    const escapedBody = body.replace(/'/g, "'\\''");
    parts.push(`-H "Content-Type: application/json"`);
    parts.push(`-d '${escapedBody}'`);
  }
  return parts.join(" ");
};

const formatJsonIfPossible = (payload: string): string => {
  if (!payload) {
    return "";
  }
  try {
    const parsed = JSON.parse(payload);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return payload;
  }
};

const normalizeQrCode = (payload: string): string => {
  if (!payload) {
    return "";
  }
  return payload.startsWith("data:") ? payload : `data:image/png;base64,${payload}`;
};

const UserApiRestClient = ({ initialSnapshot, sections, baseUrl, plans, paymentMethods }: Props) => {
  const searchParams = useSearchParams();
  const [snapshot, setSnapshot] = useState<ApiKeySnapshot>(initialSnapshot);
  const [showKey, setShowKey] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pendingAction, setPendingAction] = useState<ActionState>(null);
  const [customKey, setCustomKey] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<ApiRequestPlanSummary | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<PaymentMethodProvider | null>(null);
  const [isGeneratingPurchase, setIsGeneratingPurchase] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [purchaseCheckout, setPurchaseCheckout] = useState<PlanCheckoutResponse | null>(null);
  const [infoModalEndpoint, setInfoModalEndpoint] = useState<ApiEndpoint | null>(null);
  const [testModalEndpoint, setTestModalEndpoint] = useState<ApiEndpoint | null>(null);
  const [testModalValues, setTestModalValues] = useState<Record<string, string>>({});
  const [testModalBody, setTestModalBody] = useState("");
  const [testModalBaseUrl, setTestModalBaseUrl] = useState(baseUrl);
  const [testModalApiKey, setTestModalApiKey] = useState(initialSnapshot.apiKey ?? "");
  const [testModalResponse, setTestModalResponse] = useState<string | null>(null);
  const [testModalStatus, setTestModalStatus] = useState<number | null>(null);
  const [testModalError, setTestModalError] = useState<string | null>(null);
  const [isExecutingTest, setIsExecutingTest] = useState(false);
  const [purchaseSuccess, setPurchaseSuccess] = useState<{
    requests: number;
    planName: string | null;
  } | null>(null);

  const availableProviders = useMemo<ProviderOption[]>(() => {
    return paymentMethods
      .filter(
        (method) =>
          method.isActive &&
          method.isConfigured &&
          SUPPORTED_PROVIDERS.includes(method.provider),
      )
      .map((method) => ({
        provider: method.provider,
        label: method.displayName?.trim() || PROVIDER_FALLBACK_LABELS[method.provider],
      }));
  }, [paymentMethods]);

  const availablePlans = useMemo(() => {
    return plans
      .filter((plan) => plan && plan.isActive !== false)
      .map((plan) => ({
        ...plan,
        orderIndex: Number.isFinite(plan.orderIndex) ? Number(plan.orderIndex) : 0,
      }))
      .sort((a, b) => {
        if (a.orderIndex !== b.orderIndex) {
          return a.orderIndex - b.orderIndex;
        }
        if (a.priceCents !== b.priceCents) {
          return a.priceCents - b.priceCents;
        }
        return a.requestAmount - b.requestAmount;
      });
  }, [plans]);

  useEffect(() => {
    if (!testModalEndpoint) {
      setTestModalApiKey(snapshot.apiKey);
    }
  }, [snapshot.apiKey, testModalEndpoint]);

  useEffect(() => {
    if (!testModalEndpoint) {
      setTestModalBaseUrl(baseUrl);
    }
  }, [baseUrl, testModalEndpoint]);

  useEffect(() => {
    if (isPurchaseModalOpen && !selectedPlan && availablePlans.length > 0) {
      setSelectedPlan(availablePlans[0]);
    }
  }, [availablePlans, isPurchaseModalOpen, selectedPlan]);

  useEffect(() => {
    if (selectedPlan && (!selectedProvider || !availableProviders.some((option) => option.provider === selectedProvider))) {
      setSelectedProvider(availableProviders[0]?.provider ?? null);
    }
  }, [availableProviders, selectedPlan, selectedProvider]);

  useEffect(() => {
    if (!purchaseSuccess) return;
    const timer = setTimeout(() => {
      setPurchaseSuccess(null);
      setIsPurchaseModalOpen(false);
    }, 1500);
    return () => clearTimeout(timer);
  }, [purchaseSuccess]);

  const handleCopy = useCallback(() => {
    if (!snapshot.apiKey) {
      setFeedback({ type: "error", message: "Nenhuma chave disponível para copiar." });
      return;
    }
    navigator.clipboard
      .writeText(snapshot.apiKey)
      .then(() => setFeedback({ type: "success", message: "Chave copiada para a área de transferência." }))
      .catch(() => setFeedback({ type: "error", message: "Não foi possível copiar a chave automaticamente." }));
  }, [snapshot.apiKey]);

  const handleRotate = useCallback(async () => {
    setPendingAction("rotate");
    setFeedback(null);
    try {
      const response = await fetch("/api/user/apirest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rotate" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          (data && typeof data.message === "string" && data.message) ||
          "Não foi possível gerar uma nova chave agora.";
        throw new Error(message);
      }
      setSnapshot(normalizeSnapshot(data));
      setFeedback({
        type: "success",
        message: (data && typeof data.message === "string" && data.message) || "Nova chave gerada.",
      });
      setShowKey(true);
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Não foi possível gerar a nova chave.",
      });
    } finally {
      setPendingAction(null);
    }
  }, []);

  const handleSetCustomKey = useCallback(async () => {
    const trimmed = customKey.trim();
    if (!trimmed) {
      setFeedback({ type: "error", message: "Informe o valor da chave personalizada antes de aplicar." });
      return;
    }

    setPendingAction("custom");
    setFeedback(null);
    try {
      const response = await fetch("/api/user/apirest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_custom", apiKey: trimmed }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          (data && typeof data.message === "string" && data.message) ||
          "Não foi possível aplicar a chave personalizada.";
        throw new Error(message);
      }
      setSnapshot(normalizeSnapshot(data));
      setFeedback({
        type: "success",
        message: (data && typeof data.message === "string" && data.message) || "Chave personalizada atualizada.",
      });
      setShowKey(true);
      setCustomKey("");
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Não foi possível aplicar a nova chave.",
      });
    } finally {
      setPendingAction(null);
    }
  }, [customKey]);

  const handleRefreshSnapshot = useCallback(async () => {
    setIsRefreshing(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/user/apirest");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          (data && typeof data.message === "string" && data.message) ||
          "Não foi possível atualizar os dados agora.";
        throw new Error(message);
      }
      setSnapshot(normalizeSnapshot(data));
      setFeedback({
        type: "success",
        message: (data && typeof data.message === "string" && data.message) || "Dados atualizados com sucesso.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Não foi possível atualizar os dados agora.",
      });
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const handleOpenPurchase = useCallback(
    (plan?: ApiRequestPlanSummary | null) => {
      if (availableProviders.length === 0 && availablePlans.length === 0) {
        setFeedback({
          type: "error",
          message: "Nenhum pacote ou forma de pagamento disponível no momento.",
        });
        return;
      }
      const resolvedPlan = plan ?? availablePlans[0] ?? null;
      setSelectedPlan(resolvedPlan);
      setSelectedProvider(availableProviders[0]?.provider ?? null);
      setPurchaseCheckout(null);
      setPurchaseError(null);
      setPurchaseSuccess(null);
      setIsPurchaseModalOpen(true);
    },
    [availablePlans, availableProviders, setFeedback],
  );

  const handleClosePurchase = useCallback(() => {
    if (isGeneratingPurchase) {
      return;
    }
    setIsPurchaseModalOpen(false);
    setSelectedPlan(null);
    setPurchaseCheckout(null);
    setPurchaseError(null);
    setSelectedProvider(null);
    setPurchaseSuccess(null);
  }, [isGeneratingPurchase]);

  const handleConfirmPurchase = useCallback(async () => {
    if (!selectedPlan) {
      setPurchaseError("Selecione um pacote válido.");
      return;
    }
    if (!selectedProvider) {
      setPurchaseError("Escolha a forma de pagamento desejada.");
      return;
    }

    setIsGeneratingPurchase(true);
    setPurchaseError(null);
    setPurchaseCheckout(null);
    setPurchaseSuccess(null);

    try {
      const response = await fetch("/api/user/apirest/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: selectedPlan.id,
          provider: selectedProvider,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          (data && typeof data.message === "string" && data.message) ||
          "Não foi possível gerar o pagamento.";
        throw new Error(message);
      }

      const checkout = data?.checkout as PlanCheckoutResponse | undefined;
      if (!checkout) {
        throw new Error("Resposta inesperada do servidor. Tente novamente em instantes.");
      }

      setPurchaseCheckout(checkout);
      try {
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(
            "apirest:pending-payment",
            JSON.stringify({
              id: checkout.providerPaymentId,
              planId: selectedPlan.id,
              planName: selectedPlan.name,
              requestAmount: selectedPlan.requestAmount,
            }),
          );
        }
      } catch {
        /* ignore storage errors */
      }
      setFeedback({
        type: "success",
        message:
          (data && typeof data.message === "string" && data.message) ||
          "Pagamento gerado com sucesso. Assim que confirmado, seu saldo será atualizado automaticamente.",
      });
    } catch (error) {
      setPurchaseError(error instanceof Error ? error.message : "Não foi possível gerar o pagamento.");
    } finally {
      setIsGeneratingPurchase(false);
    }
  }, [selectedPlan, selectedProvider]);

  const handleOpenInfoModal = useCallback((endpoint: ApiEndpoint) => {
    setInfoModalEndpoint(endpoint);
  }, []);

  const handleCloseInfoModal = useCallback(() => {
    setInfoModalEndpoint(null);
  }, []);

  const handleOpenTestModal = useCallback(
    (endpoint: ApiEndpoint) => {
      setTestModalEndpoint(endpoint);
      setTestModalBaseUrl(baseUrl);
      setTestModalApiKey(snapshot.apiKey || "");
      const defaults: Record<string, string> = {};
      endpoint.queryParams?.forEach((param) => {
        const sampleValue = endpoint.sampleQuery?.[param.name];
        defaults[param.name] = sampleValue ?? "";
      });
      setTestModalValues(defaults);
      const defaultBody =
        typeof endpoint.sampleBody === "string"
          ? endpoint.sampleBody
          : endpoint.sampleBody
            ? JSON.stringify(endpoint.sampleBody, null, 2)
            : "";
      setTestModalBody(defaultBody || "");
      setTestModalResponse(null);
      setTestModalStatus(null);
      setTestModalError(null);
    },
    [baseUrl, snapshot.apiKey],
  );

  const handleCloseTestModal = useCallback(() => {
    setTestModalEndpoint(null);
    setTestModalResponse(null);
    setTestModalStatus(null);
    setTestModalError(null);
    setTestModalBody("");
    setIsExecutingTest(false);
  }, []);

  const handleTestFieldChange = useCallback((name: string, value: string) => {
    setTestModalValues((current) => ({
      ...current,
      [name]: value,
    }));
  }, []);

  const handleExecuteTest = useCallback(async () => {
    if (!testModalEndpoint) {
      return;
    }
    setIsExecutingTest(true);
    setTestModalError(null);
    setTestModalResponse(null);
    setTestModalStatus(null);
    try {
      const effectiveBase = testModalBaseUrl?.trim() || baseUrl;
      const effectiveApiKey = (testModalApiKey || snapshot.apiKey || "").trim();
      const url = buildEndpointUrl(effectiveBase, testModalEndpoint, testModalValues, effectiveApiKey);
      const method = (testModalEndpoint.method || "GET").toUpperCase();
      const trimmedBody = testModalBody.trim();
      const init: RequestInit = {
        method,
        headers: { accept: "application/json" },
      };
      if (method !== "GET" && trimmedBody) {
        init.headers = { ...init.headers, "Content-Type": "application/json" };
        init.body = trimmedBody;
      }
      const response = await fetch(url.toString(), init);
      setTestModalStatus(response.status);
      const text = await response.text();
      const formatted = formatJsonIfPossible(text);
      setTestModalResponse(formatted);
      if (!response.ok) {
        const errorMessage = `Requisição retornou HTTP ${response.status}.`;
        setTestModalError(errorMessage);
      }
    } catch (error) {
      setTestModalError(error instanceof Error ? error.message : "Falha ao executar a requisição.");
    } finally {
      setIsExecutingTest(false);
    }
  }, [
    baseUrl,
    snapshot.apiKey,
    testModalApiKey,
    testModalBaseUrl,
    testModalEndpoint,
    testModalValues,
    testModalBody,
  ]);

  const handleCopyCurlCommand = useCallback(() => {
    if (!testModalEndpoint) {
      return;
    }
    const effectiveBase = testModalBaseUrl?.trim() || baseUrl;
    const effectiveApiKey = (testModalApiKey || snapshot.apiKey || "").trim();
    const curl = buildCurlCommand(
      effectiveBase,
      testModalEndpoint,
      testModalValues,
      effectiveApiKey,
      testModalBody.trim(),
    );
    navigator.clipboard
      .writeText(curl)
      .then(() =>
        setFeedback({
          type: "success",
          message: "Comando cURL copiado para a área de transferência.",
        }),
      )
      .catch(() =>
        setFeedback({
          type: "error",
          message: "Não foi possível copiar o comando cURL automaticamente.",
        }),
      );
  }, [
    baseUrl,
    snapshot.apiKey,
    testModalApiKey,
    testModalBaseUrl,
    testModalEndpoint,
    testModalValues,
    testModalBody,
    setFeedback,
  ]);

  const handleCopyPixCode = useCallback(() => {
    if (!purchaseCheckout?.qrCode) {
      return;
    }
    navigator.clipboard
      .writeText(purchaseCheckout.qrCode)
      .then(() =>
        setFeedback({
          type: "success",
          message: "Código Pix copiado para a área de transferência.",
        }),
      )
      .catch(() =>
        setFeedback({
          type: "error",
          message: "Não foi possível copiar o código Pix automaticamente.",
        }),
      );
  }, [purchaseCheckout?.qrCode, setFeedback]);

  const applyPurchaseApproval = useCallback(
    async ({
      requestAmount,
      planId,
      planName,
    }: {
      requestAmount?: number | null;
      planId?: number | null;
      planName?: string | null;
    }) => {
      const resolvedPlan =
        (Number.isFinite(planId) && planId
          ? availablePlans.find((plan) => plan.id === planId)
          : null) ?? selectedPlan ?? null;
      const planRequests = resolvedPlan?.requestAmount ?? 0;
      const resolvedRequests =
        Number.isFinite(requestAmount) && requestAmount && requestAmount > 0
          ? Math.floor(requestAmount)
          : planRequests;
      const resolvedPlanName = planName ?? resolvedPlan?.name ?? "Pacote";

      setIsPurchaseModalOpen(true);
      setPurchaseSuccess({
        requests: Math.max(0, resolvedRequests),
        planName: resolvedPlanName,
      });
      setPurchaseCheckout(null);
      setPurchaseError(null);
      setFeedback(null);
      try {
        if (typeof window !== "undefined") {
          window.sessionStorage.removeItem("apirest:pending-payment");
        }
      } catch {
        /* ignore */
      }
      try {
        const response = await fetch("/api/user/apirest", { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (response.ok) {
          setSnapshot(normalizeSnapshot(data));
        }
      } catch {
        /* ignore refresh failures */
      }
    },
    [availablePlans, selectedPlan],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const statusParam = (searchParams?.get("status") || "").toLowerCase();
    if (statusParam !== "success") {
      return;
    }
    const raw = window.sessionStorage.getItem("apirest:pending-payment");
    if (!raw) {
      return;
    }
    try {
      const cached = JSON.parse(raw) as {
        id?: string;
        planId?: number;
        planName?: string;
        requestAmount?: number;
      } | null;
      const id = cached?.id ? String(cached.id).trim() : "";
      if (!id) {
        return;
      }
      (async () => {
        try {
          const res = await fetch(`/api/user/apirest/status?paymentId=${encodeURIComponent(id)}`, {
            cache: "no-store",
          });
          if (!res.ok) return;
          const data = await res.json().catch(() => ({} as any));
          const statusValue = String((data as any).status || "").toLowerCase();
          if (statusValue === "approved") {
            await applyPurchaseApproval({
              requestAmount:
                typeof (data as any).requestAmount === "number"
                  ? (data as any).requestAmount
                  : cached?.requestAmount,
              planId:
                typeof (data as any)?.plan?.id === "number"
                  ? (data as any).plan.id
                  : cached?.planId ?? null,
              planName:
                typeof (data as any)?.plan?.name === "string"
                  ? (data as any).plan.name
                  : cached?.planName ?? null,
            });
          }
        } catch {
          /* ignore */
        }
      })();
    } catch {
      /* ignore */
    }
  }, [searchParams, applyPurchaseApproval]);

  useEffect(() => {
    if (!isPurchaseModalOpen || !purchaseCheckout) {
      return;
    }
    const paymentId = purchaseCheckout.providerPaymentId;

    const poll = async () => {
      try {
        const res = await fetch(`/api/user/apirest/status?paymentId=${encodeURIComponent(paymentId)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json().catch(() => ({} as any));
        const statusValue = String((data as any).status || "").toLowerCase();
        if (statusValue === "approved") {
          await applyPurchaseApproval({
            requestAmount: typeof (data as any).requestAmount === "number" ? (data as any).requestAmount : undefined,
            planId: typeof (data as any)?.plan?.id === "number" ? (data as any).plan.id : undefined,
            planName: typeof (data as any)?.plan?.name === "string" ? (data as any).plan.name : undefined,
          });
        }
      } catch {
        /* ignore polling errors */
      }
    };

    const kickoff = setTimeout(poll, 2000);
    const interval = setInterval(poll, 5000);
    return () => {
      clearTimeout(kickoff);
      clearInterval(interval);
    };
  }, [isPurchaseModalOpen, purchaseCheckout, applyPurchaseApproval]);

  const quotaDetails = useMemo(() => {
    const total = Math.max(0, snapshot.dailyQuota);
    const used = Math.max(0, snapshot.requestsUsed);
    const remaining = Math.max(0, total - used);
    const usedPercent = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
    return { total, used, remaining, usedPercent };
  }, [snapshot.dailyQuota, snapshot.requestsUsed]);

  const testModalPreviewUrl = useMemo(() => {
    if (!testModalEndpoint) {
      return "";
    }
    try {
      const effectiveBase = testModalBaseUrl?.trim() || baseUrl;
      const effectiveApiKey = (testModalApiKey || snapshot.apiKey || "").trim();
      return buildEndpointUrl(effectiveBase, testModalEndpoint, testModalValues, effectiveApiKey).toString();
    } catch {
      return "";
    }
  }, [
    baseUrl,
    snapshot.apiKey,
    testModalApiKey,
    testModalBaseUrl,
    testModalEndpoint,
    testModalValues,
  ]);

  return (
    <div className="d-flex flex-column gap-4">
      <div className="d-flex flex-column flex-lg-row align-items-lg-center justify-content-lg-end mb-2">
        <button
          type="button"
          className="btn btn-success align-self-start align-self-lg-end"
          onClick={() => handleOpenPurchase()}
        >
          Comprar limite
        </button>
      </div>
      <section className="card shadow-sm border-0">
        <div className="card-body">
          <h2 className="h5 mb-3">Autenticação</h2>
          <p className="text-secondary mb-4">
            Utilize esta chave para autenticar as requisições na API REST. Envie-a no cabeçalho{" "}
            <code>Authorization: Bearer sua_chave</code>, no cabeçalho <code>X-API-Key</code> ou como parâmetro{" "}
            <code>apikey=</code> na URL. Você pode definir uma chave personalizada para simplificar integrações.
          </p>

          {feedback ? (
            <div
              className={`alert ${feedback.type === "success" ? "alert-success" : "alert-danger"} d-flex justify-content-between align-items-center`}
              role="alert"
            >
              <span>{feedback.message}</span>
              <button
                type="button"
                className="btn-close"
                aria-label="Fechar"
                onClick={() => setFeedback(null)}
              />
            </div>
          ) : null}

          <div className="mb-3">
            <label className="form-label fw-semibold">Chave de API ativa</label>
            <div className="input-group">
              <input
                type={showKey ? "text" : "password"}
                className="form-control"
                value={snapshot.apiKey}
                readOnly
              />
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => setShowKey((current) => !current)}
              >
                {showKey ? "Ocultar" : "Mostrar"}
              </button>
              <button type="button" className="btn btn-outline-secondary" onClick={handleCopy}>
                Copiar
              </button>
            </div>
            <small className="text-secondary">
              Gere uma nova chave se suspeitar de uso indevido. A chave atual será invalidada imediatamente.
            </small>
          </div>

          <div className="d-flex flex-wrap gap-2 mb-4">
            <button
              type="button"
              className="btn btn-primary"
              disabled={pendingAction === "rotate"}
              onClick={handleRotate}
            >
              {pendingAction === "rotate" ? "Gerando..." : "Gerar nova chave"}
            </button>
          </div>

          <div className="mb-3">
            <label className="form-label fw-semibold">Definir chave personalizada</label>
            <div className="input-group">
              <input
                type="text"
                className="form-control"
                value={customKey}
                onChange={(event) => setCustomKey(event.target.value)}
                placeholder="Ex.: minha_apikey_exclusiva"
                autoComplete="off"
              />
              <button
                type="button"
                className="btn btn-outline-primary"
                onClick={handleSetCustomKey}
                disabled={pendingAction === "custom"}
              >
                {pendingAction === "custom" ? "Aplicando..." : "Aplicar"}
              </button>
            </div>
            <small className="text-secondary">
              A chave deve ter entre 4 e 64 caracteres, utilizando apenas letras, números, hífen ou underline.
            </small>
          </div>
        </div>
      </section>

      <section className="card shadow-sm border-0">
        <div className="card-body">
          <div className="d-flex flex-column flex-lg-row align-items-lg-center justify-content-between mb-3 gap-3">
            <h2 className="h5 mb-0">Saldo de requisições</h2>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={handleRefreshSnapshot}
              disabled={isRefreshing}
            >
              {isRefreshing ? "Atualizando..." : "Atualizar dados"}
            </button>
          </div>
          <div className="row g-3">
            <div className="col-12 col-md-6 col-lg-3">
              <div className="border rounded p-3 h-100">
                <span className="text-secondary text-uppercase d-block small fw-semibold">Disponíveis</span>
                <span className="fs-4 fw-semibold">{formatInteger(quotaDetails.remaining)}</span>
                <small className="d-block text-secondary">Requisições prontas para uso.</small>
              </div>
            </div>
            <div className="col-12 col-md-6 col-lg-3">
              <div className="border rounded p-3 h-100">
                <span className="text-secondary text-uppercase d-block small fw-semibold">Total contratado</span>
                <span className="fs-4 fw-semibold">{formatInteger(quotaDetails.total)}</span>
                <small className="d-block text-secondary">Inclui o pacote base e compras adicionais.</small>
              </div>
            </div>
            <div className="col-12 col-md-6 col-lg-3">
              <div className="border rounded p-3 h-100">
                <span className="text-secondary text-uppercase d-block small fw-semibold">Utilizadas</span>
                <span className="fs-4 fw-semibold">{formatInteger(quotaDetails.used)}</span>
                <div className="d-flex align-items-center gap-2 mt-2">
                  <div className="progress flex-grow-1" style={{ height: 6 }}>
                    <div
                      className="progress-bar bg-primary"
                      role="progressbar"
                      aria-valuenow={quotaDetails.usedPercent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      style={{ width: `${quotaDetails.usedPercent}%` }}
                    />
                  </div>
                  <span className="fw-semibold text-secondary">{quotaDetails.usedPercent}%</span>
                </div>
                <small className="d-block text-secondary">Consumo acumulado da sua chave atual.</small>
              </div>
            </div>
            <div className="col-12 col-md-6 col-lg-3">
              <div className="border rounded p-3 h-100">
                <span className="text-secondary text-uppercase d-block small fw-semibold">Última atualização</span>
                <span className="fs-5 fw-semibold">{formatDateTime(snapshot.updatedAt)}</span>
                <small className="d-block text-secondary">
                  Atualize os dados após uma nova compra ou sempre que precisar conferir o saldo.
                </small>
              </div>
            </div>
          </div>
        </div>
      </section>

      {sections.map((section) => (
        <section key={section.title} className="card shadow-sm border-0">
          <div className="card-body">
            <div className="d-flex flex-column gap-2 mb-3">
              <h2 className="h5 mb-0">{section.title}</h2>
              {section.description ? <p className="text-secondary mb-0">{section.description}</p> : null}
            </div>

            <div className="d-flex flex-column gap-2">
              {section.endpoints.map((endpoint, endpointIndex) => {
                const shortName = getEndpointShortName(endpoint);
                return (
                  <div
                    key={`${section.title}-${endpointIndex}-${endpoint.method}:${endpoint.path}`}
                    className="border rounded px-3 py-2 d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-2"
                  >
                    <div className="d-flex flex-column flex-sm-row align-items-start align-items-sm-center gap-2">
                      <div className="d-flex align-items-center gap-2">
                        <span className="badge bg-primary-subtle border text-primary fw-semibold">
                          {endpoint.method}
                        </span>
                        <span className="fw-semibold text-uppercase">{shortName}</span>
                      </div>
                      <span className="text-secondary small text-start text-sm-start">
                        {endpoint.name}
                      </span>
                    </div>
                    <div className="d-flex align-items-center gap-2">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() => handleOpenInfoModal(endpoint)}
                        aria-label={`Detalhes de ${endpoint.name}`}
                        title="Ver detalhes"
                      >
                        ?
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => handleOpenTestModal(endpoint)}
                        aria-label={`Testar ${endpoint.name} com cURL`}
                      >
                        cURL
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ))}

      <Modal
        show={Boolean(infoModalEndpoint)}
        onHide={handleCloseInfoModal}
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title>Detalhes do endpoint</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {infoModalEndpoint ? (
            <div className="d-flex flex-column gap-3">
              <div>
                <span className="badge bg-primary-subtle border text-primary fw-semibold me-2">
                  {infoModalEndpoint.method}
                </span>
                <code>{infoModalEndpoint.path}</code>
              </div>
              <div>
                <div className="fw-semibold mb-1">{infoModalEndpoint.name}</div>
                <p className="text-secondary mb-0">{infoModalEndpoint.description}</p>
              </div>
              {infoModalEndpoint.notes?.length ? (
                <div>
                  <div className="text-secondary text-uppercase small fw-semibold mb-1">Observações</div>
                  <ul className="text-secondary small mb-0 ps-3">
                    {infoModalEndpoint.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div>
                <div className="text-secondary text-uppercase small fw-semibold mb-1">Parâmetros</div>
                {infoModalEndpoint.queryParams?.length ? (
                  <ul className="list-unstyled mb-0">
                    {infoModalEndpoint.queryParams.map((param) => (
                      <li key={param.name} className="mb-2">
                        <div className="d-flex align-items-center gap-1">
                          <code>{param.name}</code>
                          {param.required ? <span className="text-danger fw-semibold">*</span> : null}
                        </div>
                        <div className="text-secondary small">{param.description}</div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-secondary small">Nenhum parâmetro necessário.</span>
                )}
              </div>
              <div>
                <div className="text-secondary text-uppercase small fw-semibold mb-1">Exemplo completo</div>
                <code className="d-block small text-break">
                  {buildSampleUrl(baseUrl, infoModalEndpoint, snapshot.apiKey || "SUA_CHAVE")}
                </code>
              </div>
              {infoModalEndpoint.sampleBody ? (
                <div>
                  <div className="text-secondary text-uppercase small fw-semibold mb-1">
                    Payload (JSON)
                  </div>
                  <pre className="bg-body-tertiary p-2 rounded small mb-0">
                    {typeof infoModalEndpoint.sampleBody === "string"
                      ? infoModalEndpoint.sampleBody
                      : JSON.stringify(infoModalEndpoint.sampleBody, null, 2)}
                  </pre>
                </div>
              ) : null}
            </div>
          ) : null}
        </Modal.Body>
      </Modal>

      <Modal
        show={Boolean(testModalEndpoint)}
        onHide={handleCloseTestModal}
        centered
        size="lg"
        backdrop={isExecutingTest ? "static" : true}
        keyboard={!isExecutingTest}
      >
        <Modal.Header closeButton={!isExecutingTest}>
          <Modal.Title>
            {testModalEndpoint ? `Testar ${getEndpointShortName(testModalEndpoint)}` : "Teste de endpoint"}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {testModalEndpoint ? (
            <div className="d-flex flex-column gap-3">
              <div className="row g-3">
                <div className="col-12 col-md-6">
                  <label className="form-label small text-uppercase fw-semibold">Base URL</label>
                  <input
                    type="text"
                    className="form-control"
                    value={testModalBaseUrl}
                    onChange={(event) => setTestModalBaseUrl(event.target.value)}
                    placeholder={baseUrl}
                  />
                </div>
                <div className="col-12 col-md-6">
                  <label className="form-label small text-uppercase fw-semibold">Chave de API</label>
                  <input
                    type="text"
                    className="form-control"
                    value={testModalApiKey}
                    onChange={(event) => setTestModalApiKey(event.target.value)}
                    placeholder="Informe sua chave (apikey)"
                  />
                  <small className="text-secondary">Será enviada como parâmetro <code>apikey</code>.</small>
                </div>
              </div>

              {testModalEndpoint.queryParams?.length ? (
                <div className="d-flex flex-column gap-2">
                  <div className="text-secondary text-uppercase small fw-semibold">Parâmetros da requisição</div>
                  {testModalEndpoint.queryParams.map((param) => (
                    <div key={param.name}>
                      <label className="form-label fw-semibold">
                        {param.name}
                        {param.required ? <span className="text-danger ms-1">*</span> : null}
                      </label>
                      <input
                        type="text"
                        className="form-control"
                        value={testModalValues[param.name] ?? ""}
                        onChange={(event) => handleTestFieldChange(param.name, event.target.value)}
                        placeholder={testModalEndpoint.sampleQuery?.[param.name] || ""}
                      />
                      {param.description ? (
                        <small className="text-secondary d-block mt-1">{param.description}</small>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="alert alert-light border mb-0">
                  Este endpoint não exige parâmetros adicionais.
                </div>
              )}

              {(((testModalEndpoint.method || "GET").toUpperCase() !== "GET") ||
                Boolean(testModalEndpoint.sampleBody)) && (
                <div className="d-flex flex-column gap-2">
                  <div className="text-secondary text-uppercase small fw-semibold">Corpo (JSON)</div>
                  <textarea
                    className="form-control"
                    rows={4}
                    value={testModalBody}
                    onChange={(event) => setTestModalBody(event.target.value)}
                    placeholder='{"type":"text","body":"Olá!"}'
                    disabled={isExecutingTest}
                  />
                </div>
              )}

              {testModalPreviewUrl ? (
                <div>
                  <div className="text-secondary text-uppercase small fw-semibold mb-1">URL da requisição</div>
                  <code className="d-block small text-break">{testModalPreviewUrl}</code>
                </div>
              ) : null}

              {testModalError ? <div className="alert alert-danger mb-0">{testModalError}</div> : null}
              {testModalResponse ? (
                <div>
                  <div className="text-secondary text-uppercase small fw-semibold mb-1">
                    Resposta {testModalStatus ? `(HTTP ${testModalStatus})` : ""}
                  </div>
                  <pre className="bg-light border p-3 rounded overflow-auto text-dark" style={{ maxHeight: 260 }}>
                    <code className="text-dark">{testModalResponse}</code>
                  </pre>
                </div>
              ) : null}
            </div>
          ) : null}
        </Modal.Body>
        <Modal.Footer>
          <button
            type="button"
            className="btn btn-outline-secondary me-auto"
            onClick={handleCopyCurlCommand}
            disabled={!testModalEndpoint}
          >
            Copiar cURL completo
          </button>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={handleCloseTestModal}
            disabled={isExecutingTest}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleExecuteTest}
            disabled={!testModalEndpoint || isExecutingTest}
          >
            {isExecutingTest ? "Enviando..." : "Enviar requisição"}
          </button>
        </Modal.Footer>
      </Modal>

      <Modal
        show={isPurchaseModalOpen}
        onHide={handleClosePurchase}
        centered
        backdrop="static"
      >
        <Modal.Header closeButton={!isGeneratingPurchase}>
          <Modal.Title>Comprar pacote de requisições</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {purchaseSuccess ? (
            <div className="d-flex flex-column align-items-center text-center gap-3">
              <Image src="/payments/pagamento-concluido.gif" alt="Pagamento concluído" width={220} height={220} />
              <div>
                <div className="fw-semibold">Pagamento confirmado!</div>
                <div className="text-secondary">
                  {purchaseSuccess.planName ? (
                    <>
                      Pacote <strong>{purchaseSuccess.planName}</strong> liberado.
                    </>
                  ) : (
                    <>Pacote liberado.</>
                  )}{" "}
                  {purchaseSuccess.requests > 0
                    ? `${purchaseSuccess.requests.toLocaleString("pt-BR")} requisições foram creditadas ao seu limite.`
                    : "Seu limite foi atualizado."}
                </div>
              </div>
            </div>
          ) : purchaseCheckout ? (
            <div className="d-flex flex-column gap-3">
              <div className="alert alert-success mb-0">
                Pagamento gerado com sucesso. Finalize o Pix para que o saldo seja liberado automaticamente.
              </div>
              <div>
                <div className="text-secondary text-uppercase small fw-semibold">Valor</div>
                <div className="fw-semibold fs-5">{formatCurrency(purchaseCheckout.amount)}</div>
              </div>
              {purchaseCheckout.expiresAt ? (
                <div className="text-secondary small">
                  Válido até {formatDateTime(purchaseCheckout.expiresAt)}.
                </div>
              ) : null}
              {purchaseCheckout.qrCodeBase64 ? (
                <div className="text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={normalizeQrCode(purchaseCheckout.qrCodeBase64)}
                    alt="QR Code para pagamento Pix"
                    className="img-fluid border rounded"
                    style={{ maxWidth: 260 }}
                  />
                  <div className="text-secondary small mt-2">Escaneie o QR Code com o app do seu banco.</div>
                </div>
              ) : null}
              {purchaseCheckout.qrCode ? (
                <div className="d-flex flex-column gap-2">
                  <div className="text-secondary text-uppercase small fw-semibold">Código Pix copia e cola</div>
                  <code className="bg-light border rounded px-3 py-2 text-break">
                    {purchaseCheckout.qrCode}
                  </code>
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm align-self-start"
                    onClick={handleCopyPixCode}
                  >
                    Copiar código Pix
                  </button>
                </div>
              ) : null}
              {purchaseCheckout.ticketUrl ? (
                <div className="text-center">
                  <a
                    href={purchaseCheckout.ticketUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-outline-primary"
                  >
                    Abrir comprovante
                  </a>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="d-flex flex-column gap-3">
              <div>
                <div className="text-secondary text-uppercase small fw-semibold mb-2">Selecione o pacote</div>
                {availablePlans.length ? (
                  <div className="d-flex flex-column gap-2">
                    {availablePlans.map((plan) => {
                      const isActive = selectedPlan?.id === plan.id;
                      return (
                        <label
                          key={plan.id}
                          className={`border rounded p-3 d-flex flex-column flex-md-row align-items-md-center gap-2 ${isActive ? "border-primary" : ""}`}
                        >
                          <div className="form-check">
                            <input
                              type="radio"
                              name="api-rest-plan"
                              className="form-check-input"
                              value={plan.id}
                              checked={isActive}
                              onChange={() => setSelectedPlan(plan)}
                            />
                          </div>
                          <div className="flex-grow-1">
                            <div className="fw-semibold">{plan.name}</div>
                            <div className="text-secondary small">
                              {formatInteger(plan.requestAmount)} requisições · {formatCurrencyFromCents(plan.priceCents)}
                            </div>
                            {plan.description ? (
                              <div className="text-secondary small mt-1">{plan.description}</div>
                            ) : null}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <div className="alert alert-info mb-0">
                    Nenhum pacote de requisições está disponível no momento. Entre em contato com o suporte.
                  </div>
                )}
              </div>

              <div>
                <div className="text-secondary text-uppercase small fw-semibold mb-2">Forma de pagamento</div>
                {availableProviders.length === 0 ? (
                  <div className="alert alert-warning mb-0">
                    Nenhuma forma de pagamento está configurada. Entre em contato com o suporte para concluir a compra.
                  </div>
                ) : (
                  <div className="d-flex flex-column gap-2">
                    {availableProviders.map((option) => (
                      <label
                        key={option.provider}
                        className={`border rounded p-3 d-flex align-items-start gap-3 ${selectedProvider === option.provider ? "border-primary" : ""}`}
                      >
                        <input
                          type="radio"
                          name="api-rest-provider"
                          value={option.provider}
                          className="form-check-input mt-1"
                          checked={selectedProvider === option.provider}
                          onChange={() => setSelectedProvider(option.provider)}
                        />
                        <div>
                          <div className="fw-semibold">{option.label}</div>
                          <div className="text-secondary small">
                            {option.provider === "mercadopago_pix"
                              ? "Pagamento instantâneo via Pix (Mercado Pago)."
                              : option.provider === "polopag_pix"
                                ? "Pagamento instantâneo via Pix (PoloPag)."
                                : "Checkout completo Mercado Pago (Pix ou cartão)."}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {purchaseError ? (
                <div className="alert alert-danger mb-0">{purchaseError}</div>
              ) : null}
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={handleClosePurchase}
            disabled={isGeneratingPurchase}
          >
            Fechar
          </button>
          {!purchaseCheckout ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleConfirmPurchase}
              disabled={
                isGeneratingPurchase ||
                !selectedPlan ||
                !selectedProvider ||
                availableProviders.length === 0
              }
            >
              {isGeneratingPurchase ? "Gerando pagamento..." : "Gerar pagamento"}
            </button>
          ) : null}
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default UserApiRestClient;
