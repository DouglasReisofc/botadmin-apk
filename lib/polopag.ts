const POLOPAG_BASE_URL = process.env.POLOPAG_API_URL?.trim() || "https://api.polopag.com/v1";

const toAmountString = (amount: number): string => {
  if (!Number.isFinite(amount)) {
    return "0.00";
  }
  return amount.toFixed(2);
};

export type CreatePoloPagPixChargeOptions = {
  apiKey: string;
  amount: number;
  expirationSeconds: number;
  reference: string;
  description?: string | null;
  webhookUrl?: string | null;
  infoAdicionais?: Array<{ nome: string; valor: string }>;
};

export type PoloPagPixChargeResponse = {
  internalId: string;
  txid: string;
  status: string;
  valor: string;
  qrcodeBase64: string | null;
  pixCopiaECola: string | null;
  ticketUrl: string | null;
  calendario: {
    expiracao: number;
    criado_em: string | null;
    expira_em: string | null;
    ultima_atualizacao?: string | null;
  };
  raw: Record<string, unknown>;
};

const parseString = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
};

const safeNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
};

export const createPoloPagPixCharge = async (
  options: CreatePoloPagPixChargeOptions,
): Promise<PoloPagPixChargeResponse> => {
  const {
    apiKey,
    amount,
    expirationSeconds,
    reference,
    description,
    webhookUrl,
    infoAdicionais,
  } = options;

  if (!apiKey.trim()) {
    throw new Error("Chave da API da PoloPag ausente.");
  }

  const payload: Record<string, unknown> = {
    valor: toAmountString(amount),
    calendario: {
      expiracao: Math.max(1, Math.min(86400, Math.floor(expirationSeconds))),
    },
    referencia: reference,
  };

  if (description && description.trim()) {
    payload.solicitacaoPagador = description.trim().slice(0, 140);
  }

  if (webhookUrl && webhookUrl.trim()) {
    payload.webhookUrl = webhookUrl.trim();
  }

  if (Array.isArray(infoAdicionais) && infoAdicionais.length > 0) {
    payload.infoAdicionais = infoAdicionais
      .filter((entry) => entry && typeof entry === "object" && parseString(entry.nome) && parseString(entry.valor))
      .slice(0, 10)
      .map((entry) => ({
        nome: parseString(entry.nome)!,
        valor: parseString(entry.valor)!,
      }));
  }

  const response = await fetch(`${POLOPAG_BASE_URL}/cobpix`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Api-Key": apiKey.trim(),
      "User-Agent": "StoreBotDashboard/1.0",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`PoloPag Pix creation failed: ${response.status} ${response.statusText} ${text}`);
  }

  const data = await response.json().catch(() => ({}));
  const raw = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const calendarioRaw = (raw.calendario as Record<string, unknown> | undefined) ?? undefined;
  
  return {
    internalId: parseString(raw.internalId) ?? "",
    txid: parseString(raw.txid) ?? "",
    status: parseString(raw.status) ?? "",
    valor: parseString(raw.valor) ?? toAmountString(amount),
    qrcodeBase64: parseString(raw.qrcodeBase64),
    pixCopiaECola: parseString(raw.pixCopiaECola),
    ticketUrl: parseString((raw as any)?.ticketUrl),
    calendario: {
      expiracao: safeNumber((calendarioRaw as any)?.expiracao) ?? Math.floor(expirationSeconds),
      criado_em: parseString((calendarioRaw as any)?.criado_em) ?? null,
      expira_em: parseString((calendarioRaw as any)?.expira_em) ?? null,
      ultima_atualizacao: parseString((calendarioRaw as any)?.ultima_atualizacao) ?? undefined,
    },
    raw,
  };
};

export const checkPoloPagPixCharge = async (
  apiKey: string,
  txid: string,
): Promise<PoloPagPixChargeResponse> => {
  if (!apiKey.trim()) {
    throw new Error("Chave da API da PoloPag ausente.");
  }
  if (!txid.trim()) {
    throw new Error("Txid inválido para consulta.");
  }

  const response = await fetch(`${POLOPAG_BASE_URL}/check-pix/${encodeURIComponent(txid.trim())}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "Api-Key": apiKey.trim(),
      "User-Agent": "StoreBotDashboard/1.0",
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`PoloPag Pix check failed: ${response.status} ${response.statusText} ${text}`);
  }

  const data = await response.json().catch(() => ({}));
  const raw = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const calendarioRaw = (raw.calendario as Record<string, unknown> | undefined) ?? undefined;

  return {
    internalId: parseString(raw.internalId) ?? "",
    txid: parseString(raw.txid) ?? txid.trim(),
    status: parseString(raw.status) ?? "",
    valor: parseString(raw.valor) ?? "0.00",
    qrcodeBase64: parseString(raw.qrcodeBase64),
    pixCopiaECola: parseString(raw.pixCopiaECola),
    ticketUrl: parseString((raw as any)?.ticketUrl),
    calendario: {
      expiracao: safeNumber((calendarioRaw as any)?.expiracao) ?? 0,
      criado_em: parseString((calendarioRaw as any)?.criado_em) ?? null,
      expira_em: parseString((calendarioRaw as any)?.expira_em) ?? null,
      ultima_atualizacao: parseString((calendarioRaw as any)?.ultima_atualizacao) ?? undefined,
    },
    raw,
  };
};
