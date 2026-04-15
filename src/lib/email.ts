// ─────────────────────────────────────────────────────────────────────────────
// Email utility — Mailgun SMTP via nodemailer
//
// Env vars required:
//   MAILGUN_SMTP_HOST   (e.g. smtp.mailgun.org)
//   MAILGUN_SMTP_PORT   (e.g. 587)
//   MAILGUN_SMTP_USER   (e.g. postmaster@mg.yourdomain.com)
//   MAILGUN_SMTP_PASS   (Mailgun SMTP password)
//   MAILGUN_FROM        (e.g. "Agency Name <noreply@mg.yourdomain.com>")
// ─────────────────────────────────────────────────────────────────────────────

import nodemailer from 'nodemailer'

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.MAILGUN_SMTP_HOST ?? 'smtp.mailgun.org',
    port: parseInt(process.env.MAILGUN_SMTP_PORT ?? '587', 10),
    secure: false,
    auth: {
      user: process.env.MAILGUN_SMTP_USER ?? '',
      pass: process.env.MAILGUN_SMTP_PASS ?? '',
    },
  })
}

export async function sendEmail({
  to,
  subject,
  html,
  text,
}: {
  to: string
  subject: string
  html: string
  text?: string
}): Promise<void> {
  const from = process.env.MAILGUN_FROM ?? process.env.MAILGUN_SMTP_USER ?? 'noreply@example.com'
  const transport = createTransport()
  await transport.sendMail({ from, to, subject, html, text: text ?? '' })
}
