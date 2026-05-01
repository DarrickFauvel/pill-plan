import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * GET /
 * Persistent SSE connection. Clients connect once per session; the server
 * pushes datastar-merge-signals and datastar-merge-fragments events as needed.
 */
router.get('/', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(': connected\n\n');

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, HEARTBEAT_INTERVAL_MS);

  req.on('close', () => {
    clearInterval(heartbeat);
  });
});

export default router;
