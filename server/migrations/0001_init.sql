-- Discord accounts that logged in (allow-listed in ALLOWED_DISCORD_IDS)
CREATE TABLE users (
  id TEXT PRIMARY KEY,           -- discord user id
  name TEXT NOT NULL,
  avatar TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,           -- random, stored in the cookie
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- phones paired through /auth/device; each upload is filed under the device name
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

CREATE TABLE recordings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT,
  device_name TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL,
  status TEXT NOT NULL,          -- uploading | ready
  upload_id TEXT,
  part_size INTEGER,
  recorded_at INTEGER,
  duration_ms INTEGER,
  summary TEXT,                  -- JSON from the app's post-stream summary
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX recordings_user ON recordings(user_id, created_at);
CREATE INDEX recordings_age ON recordings(status, completed_at);
