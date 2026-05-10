import nodemailer from 'nodemailer';

/** @type {import('nodemailer').Transporter | null} */
let _transporter = null;

function getTransporter() {
  if (!process.env.SMTP_HOST) return null;
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return _transporter;
}

/**
 * Send a profile share invitation email.
 * Returns false (without throwing) if SMTP is not configured.
 *
 * @param {{ to: string, profileName: string, ownerEmail: string, inviteUrl: string }} opts
 * @returns {Promise<boolean>}
 */
export async function sendInviteEmail({ to, profileName, ownerEmail, inviteUrl }) {
  const t = getTransporter();
  if (!t) return false;

  const from = process.env.SMTP_FROM ?? 'Pill Plan <noreply@example.com>';
  try {
    await t.sendMail({
      from,
      to,
      subject: `${ownerEmail} shared a Pill Plan profile with you`,
      text: [
        `${ownerEmail} has invited you to access the "${profileName}" medication profile on Pill Plan.`,
        '',
        'Accept the invitation by opening this link:',
        inviteUrl,
        '',
        'If you did not expect this invitation, you can safely ignore this email.',
      ].join('\n'),
      html: `
        <p><strong>${ownerEmail}</strong> has invited you to access the <strong>${profileName}</strong> medication profile on Pill Plan.</p>
        <p><a href="${inviteUrl}" style="display:inline-block;padding:0.75em 1.5em;background:#1A5C42;color:#fff;text-decoration:none;border-radius:6px">Accept invitation</a></p>
        <p style="color:#666;font-size:0.875em">If you did not expect this invitation, you can safely ignore this email.</p>
      `,
    });
  } catch (err) {
    console.error('[email] sendMail failed:', err.message);
    return false;
  }
  return true;
}
