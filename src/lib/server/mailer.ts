import { Resend } from "resend";
import { env } from "$env/dynamic/private";

let client: Resend | null = null;
function getClient() {
  if (!env.RESEND_API_KEY) return null;
  if (!client) client = new Resend(env.RESEND_API_KEY);
  return client;
}

type SendArgs = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export async function sendMail({ to, subject, html, text }: SendArgs) {
  const consoleOnly = env.MAILER_CONSOLE === "true";
  const c = consoleOnly ? null : getClient();
  const from = env.EMAIL_FROM;

  if (!c || !from) {
    const url = text.match(/https?:\/\/\S+/)?.[0] ?? "(no url)";
    console.log(`[mailer] to=${to} subject=${JSON.stringify(subject)} url=${url}`);
    return;
  }

  const { error } = await c.emails.send({ from, to, subject, html, text });
  if (error) {
    console.error("[mailer] resend send failed:", error);
    throw new Error(`mail send failed: ${error.message ?? error.name ?? "unknown"}`);
  }
}

// Minimal, table-based HTML for broad client compatibility. Pair with a plain
// text fallback — some clients (and spam filters) penalize HTML-only mail.
export function renderEmail(args: {
  heading: string;
  body: string;
  ctaText: string;
  url: string;
  footer?: string;
}) {
  const { heading, body, ctaText, url, footer } = args;
  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f6f6f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background:#fff;border-radius:12px;padding:32px;">
        <tr><td style="font-size:20px;font-weight:600;color:#111;padding-bottom:12px;">${heading}</td></tr>
        <tr><td style="font-size:14px;line-height:1.5;color:#444;padding-bottom:24px;">${body}</td></tr>
        <tr><td align="center" style="padding-bottom:24px;">
          <a href="${url}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-size:14px;font-weight:500;padding:12px 20px;border-radius:8px;">${ctaText}</a>
        </td></tr>
        <tr><td style="font-size:12px;line-height:1.5;color:#888;word-break:break-all;">Or copy this link:<br>${url}</td></tr>
        ${footer ? `<tr><td style="font-size:12px;color:#888;padding-top:16px;">${footer}</td></tr>` : ""}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  const text = `${heading}\n\n${body}\n\n${ctaText}: ${url}${footer ? `\n\n${footer}` : ""}`;
  return { html, text };
}
