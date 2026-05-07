CREATE TABLE IF NOT EXISTS medication_images (
  id         TEXT PRIMARY KEY,
  med_id     TEXT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  source     TEXT NOT NULL,
  url        TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_med_images_med_id ON medication_images(med_id)
