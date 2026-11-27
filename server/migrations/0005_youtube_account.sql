-- Broadcasting through a linked YouTube account instead of a pasted stream key.

-- The channel a user linked with Google OAuth. One per user.
CREATE TABLE youtube_links (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  channel_title TEXT NOT NULL,
  refresh_token TEXT NOT NULL,     -- encrypted (AES-GCM, see server/src/google.ts); never returned by any API
  stream_id TEXT,                  -- the reusable liveStream created for this user; its key is fetched when needed, not stored
  linked_at INTEGER NOT NULL
);

-- What a broadcast starts from: title, description, visibility and an optional thumbnail (image in R2).
CREATE TABLE youtube_presets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  privacy TEXT NOT NULL DEFAULT 'unlisted',   -- public | unlisted | private
  thumbnail_key TEXT,
  thumbnail_type TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX youtube_presets_user ON youtube_presets(user_id, position);

-- Broadcasts created through the app, so that only their owner can end them.
CREATE TABLE youtube_broadcasts (
  id TEXT PRIMARY KEY,             -- YouTube broadcast (= video) id
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE INDEX youtube_broadcasts_user ON youtube_broadcasts(user_id, created_at);
