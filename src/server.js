import 'dotenv/config';
import 'express-async-errors';
import express from 'express';
import cookieParser from 'cookie-parser';
import { Eta } from 'eta';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import authRoutes from './routes/auth.js';
import { requireAuth } from './middleware/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const viewsDir   = join(__dirname, 'views');
const publicDir  = join(__dirname, '..', 'public');

const eta = new Eta({
  views: viewsDir,
  cache: process.env.NODE_ENV === 'production',
});

const app = express();

app.engine('eta', (filePath, data, cb) => {
  eta.renderFileAsync(filePath, data)
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
app.get('/', (req, res) => res.redirect('/login'));

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
