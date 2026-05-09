import { Router } from 'express';
import { randomUUID } from 'crypto';
import db from '../db/client.js';
import { requireAuth, loadAppContext } from '../middleware/auth.js';
import { sendInviteEmail } from '../services/email.js';

const router = Router();

/* ─────────────────────────────────────────────────────────────
   Create invite  POST /api/settings/sharing
   ───────────────────────────────────────────────────────────── */

router.post('/api/settings/sharing', requireAuth, loadAppContext, async (req, res) => {
  if (!req.profile.isOwned) {
    return res.redirect('/app/settings?shareError=not-owner');
  }

  const email = String(req.body.inviteEmail ?? '').trim().toLowerCase();

  if (!email || !email.includes('@')) {
    return res.redirect('/app/settings?shareError=invalid-email');
  }

  if (email === req.user.email.toLowerCase()) {
    return res.redirect('/app/settings?shareError=self');
  }

  const existing = await db.execute({
    sql:  'SELECT id FROM profile_shares WHERE profile_id = ? AND invited_email = ?',
    args: [req.profile.id, email],
  });
  if (existing.rows.length) {
    return res.redirect('/app/settings?shareError=duplicate');
  }

  const id    = randomUUID();
  const token = randomUUID();
  const now   = new Date().toISOString();

  await db.execute({
    sql:  `INSERT INTO profile_shares
             (id, profile_id, owner_user_id, invited_email, invite_token, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, req.profile.id, req.user.id, email, token, now],
  });

  const siteUrl   = process.env.SITE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
  const inviteUrl = `${siteUrl}/app/invite/${token}`;

  await sendInviteEmail({
    to:          email,
    profileName: req.profile.name,
    ownerEmail:  req.user.email,
    inviteUrl,
  });

  res.redirect(`/app/settings?newInvite=${token}`);
});


/* ─────────────────────────────────────────────────────────────
   Revoke share  POST /api/settings/sharing/:id/revoke
   ───────────────────────────────────────────────────────────── */

router.post('/api/settings/sharing/:id/revoke', requireAuth, loadAppContext, async (req, res) => {
  if (!req.profile.isOwned) {
    return res.redirect('/app/settings');
  }

  await db.execute({
    sql:  'DELETE FROM profile_shares WHERE id = ? AND profile_id = ? AND owner_user_id = ?',
    args: [req.params.id, req.profile.id, req.user.id],
  });

  res.redirect('/app/settings');
});


/* ─────────────────────────────────────────────────────────────
   Accept invite page  GET /app/invite/:token  (public)
   ───────────────────────────────────────────────────────────── */

router.get('/app/invite/:token', async (req, res) => {
  const { token } = req.params;

  let loggedIn = false;
  const sessionId = req.cookies?.sid;
  if (sessionId) {
    const { rows: sessRows } = await db.execute({
      sql:  'SELECT user_id FROM sessions WHERE id = ? AND expires_at > ?',
      args: [sessionId, new Date().toISOString()],
    });
    loggedIn = sessRows.length > 0;
  }

  const { rows } = await db.execute({
    sql: `SELECT ps.id, ps.invited_email, ps.accepted_at,
                 p.name  AS profile_name,
                 u.email AS owner_email
          FROM profile_shares ps
          JOIN profiles p ON p.id  = ps.profile_id
          JOIN users    u ON u.id  = ps.owner_user_id
          WHERE ps.invite_token = ?`,
    args: [token],
  });

  if (!rows.length) {
    return res.render('pages/invite', {
      title:         'Invitation',
      saveIndicator: false,
      error:         'This invitation link is invalid or has expired.',
      share:         null,
      token,
      loggedIn,
    });
  }

  const row = rows[0];

  res.render('pages/invite', {
    title:         'Accept invitation',
    saveIndicator: false,
    error:         null,
    share: {
      profileName:    String(row.profile_name),
      ownerEmail:     String(row.owner_email),
      alreadyAccepted: !!row.accepted_at,
    },
    token,
    loggedIn,
  });
});


/* ─────────────────────────────────────────────────────────────
   Accept invite  POST /app/invite/:token/accept  (auth required)
   ───────────────────────────────────────────────────────────── */

router.post('/app/invite/:token/accept', requireAuth, async (req, res) => {
  const { token } = req.params;

  const { rows } = await db.execute({
    sql:  'SELECT id, profile_id, accepted_at FROM profile_shares WHERE invite_token = ?',
    args: [token],
  });

  if (!rows.length || rows[0].accepted_at) {
    return res.redirect('/app/grid');
  }

  const share = rows[0];

  await db.execute({
    sql:  'UPDATE profile_shares SET shared_with_user_id = ?, accepted_at = ? WHERE invite_token = ?',
    args: [req.user.id, new Date().toISOString(), token],
  });

  res.cookie('pid', String(share.profile_id), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
  });

  res.redirect('/app/grid');
});


export default router;
