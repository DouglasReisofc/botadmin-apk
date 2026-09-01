const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const normalizeWhitespace = (value: string) =>
  value
    .replace(/\r\n/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/\t/g, "  ");

const renderHeading = (block: string) => {
  const match = block.match(/^(#{1,6})\s+(.*)$/);
  if (!match) {
    return null;
  }

  const level = Math.min(match[1].length + 1, 4);
  const text = escapeHtml(match[2].trim());
  return `<h${level}>${text}</h${level}>`;
};

const renderList = (block: string) => {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return null;
  }

  if (!lines.every((line) => /^[-*+]\s+/.test(line))) {
    return null;
  }

  const items = lines
    .map((line) => line.replace(/^[-*+]\s+/, ""))
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("");

  return `<ul>${items}</ul>`;
};

const renderParagraph = (block: string) => {
  const lines = block.split("\n");
  const html = lines.map((line) => escapeHtml(line.trim())).join("<br />");
  return `<p>${html}</p>`;
};

export const termsContentToHtml = (raw: string): string => {
  if (!raw) {
    return "";
  }

  const normalized = normalizeWhitespace(raw).trim();
  if (!normalized) {
    return "";
  }

  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const htmlBlocks = blocks.map((block) => {
    const heading = renderHeading(block);
    if (heading) {
      return heading;
    }

    const list = renderList(block);
    if (list) {
      return list;
    }

    return renderParagraph(block);
  });

  return htmlBlocks.join("");
};

export const summarizeTermsContent = (raw: string, maxLength = 200): string => {
  if (!raw) {
    return "";
  }

  const normalized = normalizeWhitespace(raw)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
};

export const renderRichTextToHtml = termsContentToHtml;

export const summarizeRichText = summarizeTermsContent;
