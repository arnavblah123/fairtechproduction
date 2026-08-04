import { NextResponse } from "next/server";
import { requireUser } from "@/lib/permissions";
import { sendWhatsAppDetailed, whatsappProvider, whatsappRecipients } from "@/lib/whatsapp";

// Owner-only check that the WhatsApp setup works: sends a test message to
// every alert recipient and reports exactly what each number returned, so a
// bad token or an unapproved template is obvious straight away.
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  if (user.role !== "SUPERADMIN") {
    return NextResponse.json({ error: "Owner only" }, { status: 403 });
  }

  const provider = whatsappProvider();
  const recipients = whatsappRecipients();
  if (!provider) {
    return NextResponse.json({
      provider: null,
      recipients,
      configured: false,
      message:
        "No WhatsApp account configured yet. Set WHATSAPP_TOKEN + WHATSAPP_PHONE_ID (Meta) " +
        "or TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_WHATSAPP_FROM (Twilio) in Vercel. " +
        "Until then issue alerts go out by email.",
    });
  }

  const results = await sendWhatsAppDetailed(
    "✅ Fairtech test message — WhatsApp alerts are working. " +
      "Issues raised on the app will arrive here."
  );
  return NextResponse.json({
    provider,
    configured: true,
    template: process.env.WHATSAPP_TEMPLATE ?? null,
    recipients,
    sent: results.filter((r) => r.ok).length,
    results,
  });
}
