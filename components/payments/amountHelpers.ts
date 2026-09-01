export const formatAmount = (value: number) =>
  value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const parseAmountToken = (token: string): number | null => {
  const normalized = token.replace(/[^0-9,.-]/g, "");
  if (!normalized) {
    return null;
  }

  const usesComma = normalized.includes(",");
  const sanitized = usesComma
    ? normalized.replace(/\./g, "").replace(/,/g, ".")
    : normalized;
  const parsed = Number.parseFloat(sanitized);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const cents = Math.round(parsed * 100);
  if (!Number.isFinite(cents) || cents < 1) {
    return null;
  }

  return cents;
};

export const parseAmountText = (value: string): number[] => {
  if (!value.trim()) {
    return [];
  }

  const tokens = value
    .split(/[\n,;]/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const centsSet = new Set<number>();

  for (const token of tokens) {
    const cents = parseAmountToken(token);
    if (cents === null) {
      continue;
    }

    centsSet.add(cents);
  }

  return Array.from(centsSet)
    .sort((a, b) => a - b)
    .map((cents) => cents / 100);
};
