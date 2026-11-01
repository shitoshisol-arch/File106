// Mail delivery. With SMTP_URL set, verification links are emailed through that
// transport. Without it, the message is written to the server log and the link
// is surfaced on the confirmation page in development only — never in
// production, where a missing SMTP_URL means nobody can complete registration.

import nodemailer from 'nodemailer';

export function createMailer(config, log = console) {
  const transport = config.mail.smtpUrl
    ? nodemailer.createTransport(config.mail.smtpUrl)
    : null;

  return {
    delivered: Boolean(transport),

    async send({ to, subject, text }) {
      if (!transport) {
        log.warn(`[mail] SMTP_URL not configured. Intended message for ${to}:\n${subject}\n${text}`);
        return { delivered: false };
      }

      await transport.sendMail({ from: config.mail.from, to, subject, text });
      return { delivered: true };
    },
  };
}
