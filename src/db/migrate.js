import 'dotenv/config';
import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, 'migrations');

async function migrate() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name   TEXT PRIMARY KEY,
      ran_at TEXT NOT NULL
    )
  `);

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const { rows } = await db.execute({
      sql: 'SELECT name FROM _migrations WHERE name = ?',
      args: [file],
    });

    if (rows.length > 0) {
      console.log(`skip: ${file}`);
      continue;
    }

    const sql = await readFile(join(migrationsDir, file), 'utf-8');

    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      await db.execute({ sql: stmt, args: [] });
    }

    await db.execute({
      sql: 'INSERT INTO _migrations (name, ran_at) VALUES (?, ?)',
      args: [file, new Date().toISOString()],
    });

    console.log(`ran:  ${file}`);
  }

  console.log('migrations complete');
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
