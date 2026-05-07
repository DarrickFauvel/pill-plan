import 'dotenv/config';
import 'express-async-errors';
import express from 'express';
import cookieParser from 'cookie-parser';
import { Eta } from 'eta';
import { fileURLToPath } from 'url';
import { dirname, join, relative } from 'path';
import QRCode from 'qrcode';
import authRoutes from './routes/auth.js';
import profilesRouter from './routes/profiles.js';
import sseRouter from './routes/sse.js';
import medicationsRouter from './routes/medications.js';
import gridRouter from './routes/grid.js';
import settingsRouter from './routes/settings.js';
import billingRouter from './routes/billing.js';
import adminRouter from './routes/admin.js';
import { requireAuth, loadAppContext } from './middleware/auth.js';
import { requireAdmin } from './middleware/admin.js';
import db from './db/client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const viewsDir   = join(__dirname, 'views');
const publicDir  = join(__dirname, '..', 'public');

const eta = new Eta({
  views: viewsDir,
  cache: process.env.NODE_ENV === 'production',
});

const app = express();

app.engine('eta', (filePath, data, cb) => {
  // Eta v3 prepends views dir internally, so pass path relative to views without extension
  const name = relative(viewsDir, filePath).replace(/\.eta$/, '');
  eta.renderAsync(name, data)
    .then((html) => cb(null, html))
    .catch(cb);
});
app.set('view engine', 'eta');
app.set('views', viewsDir);

app.use(express.static(publicDir));

// Stripe webhook needs raw body — must be before express.json()
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), billingRouter);

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieParser());

// Public pages
app.get('/', async (req, res) => {
  const sid = req.cookies?.sid;
  if (sid) {
    const { rows } = await db.execute({
      sql: 'SELECT user_id FROM sessions WHERE id = ? AND expires_at > ?',
      args: [sid, new Date().toISOString()],
    });
    if (rows.length) return res.redirect('/app/grid');
  }
  res.render('pages/landing', {
    title: 'Your medications, always organized',
    saveIndicator: false,
    extraCss: '/css/landing.css',
  });
});

app.get('/login', (req, res) =>
  res.render('pages/login', {
    title: 'Sign in',
    error: req.query.error ?? null,
  })
);

app.get('/signup', (req, res) =>
  res.render('pages/signup', {
    title: 'Create account',
    error: req.query.error ?? null,
  })
);

// QR code for the site URL
app.get('/qrcode.svg', async (req, res) => {
  const url = process.env.SITE_URL ?? `${req.protocol}://${req.get('host')}`;
  const svg = await QRCode.toString(url, {
    type: 'svg',
    color: { dark: '#1A2E2A', light: '#FFFFFF' },
    margin: 2,
    width: 256,
  });
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(svg);
});

// Auth API
app.use('/api/auth', authRoutes);

// Billing
app.use('/app/billing', billingRouter);
app.use('/api/billing', billingRouter);

// Admin
app.use('/admin', requireAuth, requireAdmin, adminRouter);

// Protected app shell
app.get('/app', requireAuth, (req, res) => res.redirect('/app/grid'));

app.use('/app/profiles', requireAuth, loadAppContext, profilesRouter);

app.use('/', gridRouter);

app.use('/', settingsRouter);

app.use('/api/sse', sseRouter);

app.use('/', medicationsRouter);

// Global error handler
app.use(/** @type {import('express').ErrorRequestHandler} */ (err, req, res, _next) => {
  console.error(err);
  res.status(500).send('Something went wrong. Please try again.');
});

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`MediGrid running → http://localhost:${PORT}`);
});
