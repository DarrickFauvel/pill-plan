CREATE TABLE IF NOT EXISTS grid_entries (
  id          TEXT PRIMARY KEY,
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  med_id      TEXT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  slot_id     TEXT NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  taken_date  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'taken',
  created_at  TEXT NOT NULL,
  UNIQUE(med_id, slot_id, taken_date)
);

CREATE INDEX IF NOT EXISTS idx_grid_entries_profile_date ON grid_entries(profile_id, taken_date)
