CREATE TABLE IF NOT EXISTS time_slots (
  id         TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS medications (
  id                TEXT PRIMARY KEY,
  profile_id        TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rxcui             TEXT,
  name              TEXT NOT NULL,
  strength          TEXT,
  form              TEXT,
  instructions      TEXT,
  total_quantity    INTEGER DEFAULT 0,
  refill_threshold  INTEGER DEFAULT 7,
  active            INTEGER DEFAULT 1,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedules (
  id       TEXT PRIMARY KEY,
  med_id   TEXT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  slot_id  TEXT NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  days     TEXT NOT NULL,
  dose_qty INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_time_slots_profile_id ON time_slots(profile_id);
CREATE INDEX IF NOT EXISTS idx_medications_profile_id ON medications(profile_id);
CREATE INDEX IF NOT EXISTS idx_schedules_med_id ON schedules(med_id)
