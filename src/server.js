import 'dotenv/config';
import 'express-async-errors';
import express from 'express';
import cookieParser from 'cookie-parser';
import { Eta } from 'eta';
import { fileURLToPath } from 'url';
import { dirname, join, relative } from 'path';
import authRoutes from './routes/auth.js';
import { requireAuth } from './middleware/auth.js';
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

// Auth API
app.use('/api/auth', authRoutes);

// Protected app shell (routes added in later phases)
app.get('/app', requireAuth, (req, res) => res.redirect('/app/grid'));

// Placeholder until grid route is built
app.get('/app/grid', requireAuth, (req, res) =>
  res.send('<h1>Grid coming soon</h1><form action="/api/auth/logout" method="POST"><button>Sign out</button></form>')
);

// Global error handler
app.use(/** @type {import('express').ErrorRequestHandler} */ (err, req, res, _next) => {
  console.error(err);
  res.status(500).send('Something went wrong. Please try again.');
});

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`MediGrid running → http://localhost:${PORT}`);
});
