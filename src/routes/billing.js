import { Router } from 'express';
import Stripe from 'stripe';
import db from '../db/client.js';
import { requireAuth, loadAppContext } from '../middleware/auth.js';

const router = Router();

/** @returns {Stripe} */
function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not set');
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-04-30.basil' });
}

function siteUrl() {
  return (process.env.SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}


/* ─────────────────────────────────────────────────────────────
   Billing / upgrade page  GET /app/billing
   ───────────────────────────────────────────────────────────── */

router.get('/', requireAuth, loadAppContext, (req, res) => {
  const reasonMessages = {
    images:  'Pill photos are a Pro feature.',
    slots:   'Custom time slots are a Pro feature.',
    profiles: 'Multiple profiles are a Pro feature.',
  };
  res.render('pages/billing', {
    title:    'Plan & billing',
    path:     '/app/billing',
    profile:  req.profile,
    profiles: req.profiles,
    user:     req.user,
    reason:   reasonMessages[req.query.reason] ?? null,
    success:  req.query.success === '1',
    extraCss: '/css/billing.css',
  });
});


/* ─────────────────────────────────────────────────────────────
   Start Stripe Checkout  POST /api/billing/checkout
   ───────────────────────────────────────────────────────────── */

router.post('/checkout', requireAuth, async (req, res) => {
  if (req.user.isPro) return res.redirect('/app/billing');

  const stripe = getStripe();
  const base = siteUrl();

  /** @type {Stripe.Checkout.SessionCreateParams} */
  const params = {
    mode:               'subscription',
    line_items:         [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    customer_email:     req.user.email,
    success_url:        `${base}/app/billing?success=1`,
    cancel_url:         `${base}/app/billing`,
    metadata:           { userId: req.user.id },
    subscription_data:  { metadata: { userId: req.user.id } },
  };

  if (req.user.stripeCustomerId) {
    params.customer = req.user.stripeCustomerId;
    delete params.customer_email;
  }

  const session = await stripe.checkout.sessions.create(params);
  res.redirect(303, session.url);
});


/* ─────────────────────────────────────────────────────────────
   Stripe Customer Portal  POST /api/billing/portal
   ───────────────────────────────────────────────────────────── */

router.post('/portal', requireAuth, async (req, res) => {
  if (!req.user.stripeCustomerId) return res.redirect('/app/billing');

  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer:   req.user.stripeCustomerId,
    return_url: `${siteUrl()}/app/billing`,
  });
  res.redirect(303, session.url);
});


/* ─────────────────────────────────────────────────────────────
   Stripe Webhook  POST /api/billing/webhook
   Raw body — registered BEFORE express.json() in server.js
   ───────────────────────────────────────────────────────────── */

router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(400).send('Webhook not configured');
  }

  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return res.status(400).send('Webhook signature verification failed');
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = /** @type {Stripe.Checkout.Session} */ (event.data.object);
      if (session.mode !== 'subscription') break;
      const userId = session.metadata?.userId;
      if (!userId) break;
      await db.execute({
        sql:  `UPDATE users
               SET plan = 'pro', stripe_customer_id = ?, stripe_subscription_id = ?, plan_expires_at = NULL
               WHERE id = ?`,
        args: [session.customer, session.subscription, userId],
      });
      break;
    }

    case 'customer.subscription.updated': {
      const sub = /** @type {Stripe.Subscription} */ (event.data.object);
      const userId = sub.metadata?.userId;
      if (!userId) break;
      const expiresAt = sub.status === 'active'
        ? new Date(sub.current_period_end * 1000).toISOString()
        : new Date().toISOString();
      await db.execute({
        sql:  'UPDATE users SET plan_expires_at = ? WHERE stripe_subscription_id = ?',
        args: [expiresAt, sub.id],
      });
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = /** @type {Stripe.Subscription} */ (event.data.object);
      await db.execute({
        sql:  `UPDATE users SET plan = 'free', plan_expires_at = ? WHERE stripe_subscription_id = ?`,
        args: [new Date().toISOString(), sub.id],
      });
      break;
    }

    default:
      break;
  }

  res.json({ received: true });
});

export default router;
