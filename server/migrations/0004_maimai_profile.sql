-- maimai DX NET player profile (name, rating, icon, dan, class, ...) read by the bookmarklet together with the plays.
-- One per user; used for the profile card of the legacy shorts layout.
CREATE TABLE maimai_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,              -- JSON, see MaimaiProfile in web/src/api.ts
  updated_at INTEGER NOT NULL
);
