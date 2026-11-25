-- JPEG frame uploaded by the app after the video; stored next to the mp4 as <key>.jpg
ALTER TABLE recordings ADD COLUMN has_thumb INTEGER NOT NULL DEFAULT 0;
