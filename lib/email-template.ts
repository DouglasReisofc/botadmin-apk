interface RenderEmailTemplateOptions {
  heading: string;
  bodyHtml: string;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  footerText?: string | null;
}

export const renderEmailTemplate = ({
  heading,
  bodyHtml,
  ctaLabel,
  ctaUrl,
  footerText,
}: RenderEmailTemplateOptions): string => {
  const safeHeading = heading.trim();
  const safeBody = bodyHtml.trim();
  const button = ctaLabel && ctaUrl
    ? `<a href="${ctaUrl}" target="_blank" rel="noopener" style="display:inline-block;background:linear-gradient(135deg,#5c6cff,#8f2fff);color:#ffffff;padding:14px 28px;border-radius:999px;font-weight:600;text-decoration:none;letter-spacing:0.4px;">${ctaLabel}</a>`
    : "";

  const footer = footerText
    ? `<p style="margin:0;color:#8b8fa7;font-size:13px;line-height:20px;">${footerText}</p>`
    : "<p style=\"margin:0;color:#8b8fa7;font-size:13px;line-height:20px;\">Equipe StoreBot</p>";

  return `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeHeading}</title>
  </head>
  <body style="margin:0;background-color:#0b0f1a;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;margin:0 auto;padding:32px 16px;">
      <tr>
        <td>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:radial-gradient(circle at top,#1f2547,#0b0f1a);border-radius:24px;padding:40px 32px;border:1px solid rgba(124,138,255,0.18);box-shadow:0 25px 45px rgba(12,17,43,0.35);">
            <tr>
              <td style="text-align:center;padding-bottom:24px;">
                <span style="display:inline-block;padding:12px 24px;border-radius:999px;background:rgba(124,138,255,0.12);color:#7c8aff;font-size:12px;letter-spacing:1.6px;text-transform:uppercase;font-weight:600;">StoreBot</span>
              </td>
            </tr>
            <tr>
              <td style="text-align:center;padding-bottom:18px;">
                <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;line-height:1.3;">${safeHeading}</h1>
              </td>
            </tr>
            <tr>
              <td style="color:#c4c9f2;font-size:15px;line-height:24px;padding-bottom:28px;">
                ${safeBody}
              </td>
            </tr>
            ${button ? `<tr><td style="text-align:center;padding-bottom:28px;">${button}</td></tr>` : ""}
            <tr>
              <td style="padding-top:12px;border-top:1px solid rgba(124,138,255,0.18);text-align:center;">
                ${footer}
                <p style="margin:12px 0 0;color:#565c7a;font-size:12px;">© ${new Date().getFullYear()} StoreBot. Todos os direitos reservados.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};
