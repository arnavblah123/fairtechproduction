// Best-effort WhatsApp alerts. Two providers are supported — set whichever
// account you have and the app uses it:
//
//   Meta WhatsApp Cloud API (free tier, recommended)
//     WHATSAPP_TOKEN            permanent access token
//     WHATSAPP_PHONE_ID         the sender phone-number ID from Meta
//     WHATSAPP_TEMPLATE         optional; template name to use instead of a
//                               plain text message (needed when the recipient
//                               has not messaged the business in 24 h)
//     WHATSAPP_TEMPLATE_LANG    optional, default en
//
//   Twilio WhatsApp
//     TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
//     TWILIO_WHATSAPP_FROM      e.g. whatsapp:+14155238886
//
// Recipients: WHATSAPP_TO (comma-separated). Defaults to Jagdish and the owner.
// Never throws — a failed alert must not block work on the shop floor.

const DEFAULT_RECIPIENTS = ["917776047726", "919552594780"];

// Digits only, with the country code. Bare 10-digit numbers get +91.
function normalise(raw: string): string | null {
  const digits = raw.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

export function whatsappRecipients(): string[] {
  const configured = (process.env.WHATSAPP_TO ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const list = configured.length > 0 ? configured : DEFAULT_RECIPIENTS;
  return [...new Set(list.map(normalise).filter((n): n is string => n !== null))];
}

export function whatsappConfigured(): boolean {
  return !!(
    (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID) ||
    (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM)
  );
}

type SendResult = { ok: boolean; error?: string };

async function sendViaMeta(to: string, text: string): Promise<SendResult> {
  const token = process.env.WHATSAPP_TOKEN!;
  const phoneId = process.env.WHATSAPP_PHONE_ID!;
  const template = process.env.WHATSAPP_TEMPLATE;
  // A template is required outside the 24-hour customer service window; a
  // plain text message is fine (and simpler) inside it. Meta rejects template
  // parameters containing line breaks, so the template variant goes on one
  // line with · separators.
  const body = template
    ? {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: template,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "en" },
          components: [
            {
              type: "body",
              parameters: [{ type: "text", text: text.replace(/\s*\n+\s*/g, " · ").trim() }],
            },
          ],
        },
      }
    : {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { preview_url: false, body: text },
      };
  const base = process.env.WHATSAPP_API_BASE || "https://graph.facebook.com/v21.0";
  const res = await fetch(`${base}/${phoneId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("whatsapp (meta) failed:", res.status, detail);
    return { ok: false, error: `${res.status}: ${detail.slice(0, 300)}` };
  }
  return { ok: true };
}

async function sendViaTwilio(to: string, text: string): Promise<SendResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_WHATSAPP_FROM!;
  const params = new URLSearchParams({
    From: from.startsWith("whatsapp:") ? from : `whatsapp:+${normalise(from) ?? from}`,
    To: `whatsapp:+${to}`,
    Body: text,
  });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("whatsapp (twilio) failed:", res.status, detail);
    return { ok: false, error: `${res.status}: ${detail.slice(0, 300)}` };
  }
  return { ok: true };
}

export function whatsappProvider(): "meta" | "twilio" | null {
  if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID) return "meta";
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM) {
    return "twilio";
  }
  return null;
}

// Sends to every recipient; reports what happened to each number.
export async function sendWhatsAppDetailed(
  text: string
): Promise<{ to: string; ok: boolean; error?: string }[]> {
  const provider = whatsappProvider();
  if (!provider) return [];
  const out: { to: string; ok: boolean; error?: string }[] = [];
  for (const to of whatsappRecipients()) {
    try {
      const r = provider === "meta" ? await sendViaMeta(to, text) : await sendViaTwilio(to, text);
      out.push({ to, ...r });
    } catch (err) {
      console.error(`whatsapp to ${to} failed:`, err);
      out.push({ to, ok: false, error: String(err) });
    }
  }
  return out;
}

// Sends to every recipient; returns how many messages went out.
export async function sendWhatsApp(text: string): Promise<number> {
  return (await sendWhatsAppDetailed(text)).filter((r) => r.ok).length;
}
