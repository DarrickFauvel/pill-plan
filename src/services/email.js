import { Resend } from 'resend';

/** @type {Resend | null} */
let _client = null;

function getClient() {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_client) _client = new Resend(process.env.RESEND_API_KEY);
  return _client;
}

/**
 * Send a profile share invitation email.
 * Returns false (without throwing) if Resend is not configured or the send fails.
 *
 * @param {{ to: string, profileName: string, ownerEmail: string, inviteUrl: string }} opts
 * @returns {Promise<boolean>}
 */
export async function sendInviteEmail({ to, profileName, ownerEmail, inviteUrl }) {
  const client = getClient();
  if (!client) return false;

  const from = process.env.RESEND_FROM ?? 'Pill Plan <pillplan@darrickdevelops.com>';

  try {
    await client.emails.send({
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
    console.error('[email] sendInviteEmail failed:', err.message);
    return false;
  }

  return true;
}
