CREATE TABLE profile_shares (
  id                  TEXT PRIMARY KEY,
  profile_id          TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  owner_user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_email       TEXT NOT NULL,
  shared_with_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  invite_token        TEXT NOT NULL UNIQUE,
  created_at          TEXT NOT NULL,
  accepted_at         TEXT
);
CREATE INDEX idx_profile_shares_profile ON profile_shares(profile_id);
CREATE INDEX idx_profile_shares_token   ON profile_shares(invite_token);
CREATE INDEX idx_profile_shares_user    ON profile_shares(shared_with_user_id)
