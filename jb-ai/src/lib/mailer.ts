import "server-only";
import nodemailer from "nodemailer";

export function mailerConfigured() {
  return Boolean(process.env.SMTP_URL || process.env.SMTP_HOST);
}

function transport() {
  if (process.env.SMTP_URL) return nodemailer.createTransport(process.env.SMTP_URL);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

/** MAIL_FROM, else the SMTP login address (Gmail rejects/rewrites other senders). */
function mailFrom() {
  if (process.env.MAIL_FROM) return process.env.MAIL_FROM;
  let user = process.env.SMTP_USER || "";
  if (!user && process.env.SMTP_URL) {
    try {
      user = decodeURIComponent(new URL(process.env.SMTP_URL).username);
    } catch {
      /* ignore */
    }
  }
  return user.includes("@") ? `"محمد | التقني" <${user}>` : "محمد التقني <no-reply@localhost>";
}

export async function sendMail(to: string, subject: string, html: string, text: string): Promise<{ sent: boolean; reason?: string }> {
  if (!mailerConfigured()) {
    if (process.env.NODE_ENV !== "production") console.info(`[mailer:dev] To: ${to}\nSubject: ${subject}\n${text}`);
    return { sent: false, reason: "SMTP is not configured" };
  }
  await transport().sendMail({ from: mailFrom(), to, subject, html, text });
  return { sent: true };
}

export function appUrl(path = "") {
  const base = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return base + path;
}
