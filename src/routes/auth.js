import { Router } from 'express';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import db from '../db/client.js';

const router = Router();

const BCRYPT_ROUNDS = 12;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** @param {import('express').Response} res */
function setSessionCookie(res, sessionId) {
  res.cookie('sid', sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: SESSION_TTL_MS,
  });
}

router.post('/signup', async (req, res) => {
  const email = String(req.body.email ?? '').trim().toLowerCase();
  const password = String(req.body.password ?? '');

  if (!email || !password || password.length < 8) {
    return res.redirect('/signup?error=invalid');
  }

  const { rows: existing } = await db.execute({
    sql: 'SELECT id FROM users WHERE email = ?',
    args: [email],
  });

  if (existing.length > 0) {
    return res.redirect('/signup?error=taken');
  }

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const userId = randomUUID();
  const profileId = randomUUID();
  const sessionId = randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  await db.batch([
    {
      sql: 'INSERT INTO users (id, email, password, created_at) VALUES (?, ?, ?, ?)',
      args: [userId, email, hash, now],
    },
    {
      sql: 'INSERT INTO profiles (id, user_id, name, avatar_color, created_at) VALUES (?, ?, ?, ?, ?)',
      args: [profileId, userId, 'Me', '#6EC6A0', now],
    },
    {
      sql: 'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)',
      args: [sessionId, userId, expiresAt],
    },
  ], 'write');

  setSessionCookie(res, sessionId);
  res.redirect('/app/grid');
});

router.post('/login', async (req, res) => {
  const email = String(req.body.email ?? '').trim().toLowerCase();
  const password = String(req.body.password ?? '');

  if (!email || !password) {
    return res.redirect('/login?error=invalid');
  }

  const { rows } = await db.execute({
    sql: 'SELECT id, password FROM users WHERE email = ?',
    args: [email],
  });

  if (!rows.length) {
    return res.redirect('/login?error=invalid');
  }

  const match = await bcrypt.compare(password, String(rows[0].password));
  if (!match) {
    return res.redirect('/login?error=invalid');
  }

  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  await db.execute({
    sql: 'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)',
    args: [sessionId, String(rows[0].id), expiresAt],
  });

  setSessionCookie(res, sessionId);
  res.redirect('/app/grid');
});

router.post('/logout', async (req, res) => {
  const sessionId = req.cookies?.sid;
  if (sessionId) {
    await db.execute({
      sql: 'DELETE FROM sessions WHERE id = ?',
      args: [sessionId],
    });
  }
  res.clearCookie('sid');
  res.redirect('/login');
});

export default router;
