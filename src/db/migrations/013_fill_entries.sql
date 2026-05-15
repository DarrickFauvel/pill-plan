CREATE TABLE IF NOT EXISTS fill_entries (
  id         TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  med_id     TEXT NOT NULL,
  slot_id    TEXT NOT NULL,
  fill_date  TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS fill_entries_unique
  ON fill_entries (med_id, slot_id, fill_date);
