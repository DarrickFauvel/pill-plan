import { createClient } from '@libsql/client';

const db = createClient({
  url: process.env.TURSO_URL ?? 'file:local.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export default db;
