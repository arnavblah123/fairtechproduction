import nodemailer from "nodemailer";
import { db } from "@/lib/db";

// Best-effort owner email. Configured via env:
//   SMTP_USER + SMTP_PASS  (for Gmail: the address + an App Password)
//   SMTP_HOST (default smtp.gmail.com), SMTP_PORT (default 465)
//   MAIL_TO   (default: the superadmin's email)
// Returns false without throwing when not configured or sending fails —
// email must never block production actions.
export async function sendOwnerEmail(subject: string, html: string): Promise<boolean> {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return false;

  let to = process.env.MAIL_TO;
  if (!to) {
    const owner = await db.user.findFirst({ where: { role: "SUPERADMIN", active: true } });
    to = owner?.email;
  }
  if (!to) return false;

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT || 465),
      secure: Number(process.env.SMTP_PORT || 465) === 465,
      auth: { user, pass },
    });
    await transporter.sendMail({ from: `Fairtech Production <${user}>`, to, subject, html });
    return true;
  } catch (err) {
    console.error("owner email failed:", err);
    return false;
  }
}
