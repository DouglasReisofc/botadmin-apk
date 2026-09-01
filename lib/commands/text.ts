export const stripDiacritics = (value: string): string =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export const canonicalizeCommandText = (value: string | null | undefined): string => {
  if (value === null || value === undefined) {
    return "";
  }
  return stripDiacritics(String(value))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
};
