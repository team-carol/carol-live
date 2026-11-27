-- per-recording analysis from the app: button clicks per second (base64), used by the web to split songs
ALTER TABLE recordings ADD COLUMN analysis TEXT;

-- maimai DX NET play history imported by the user (bookmarklet on the record page -> /import)
-- matched to recordings by time on the web
CREATE TABLE plays (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  played_at INTEGER NOT NULL,      -- epoch ms of the play date shown on maimai DX NET (minute precision, JST)
  track INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  difficulty TEXT,                 -- basic | advanced | expert | master | remaster | utage
  achievement REAL,                -- 100.5 means 100.5000%
  details TEXT,                    -- JSON: chart type, rank, fc/fs, dx score, jacket url, ...
  imported_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, played_at, track, title)
);
CREATE INDEX plays_user_time ON plays(user_id, played_at);
