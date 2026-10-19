CREATE TABLE IF NOT EXISTS import_jobs (
  id TEXT PRIMARY KEY COLLATE BINARY
    CHECK (length(id) BETWEEN 1 AND 200),
  url TEXT NOT NULL
    CHECK (length(url) BETWEEN 1 AND 2048),
  title TEXT NOT NULL
    CHECK (length(trim(title)) BETWEEN 1 AND 500),
  artist TEXT NOT NULL
    CHECK (length(trim(artist)) BETWEEN 1 AND 500),
  album TEXT
    CHECK (album IS NULL OR length(trim(album)) BETWEEN 1 AND 500),
  format_id TEXT NOT NULL
    CHECK (length(trim(format_id)) BETWEEN 1 AND 128),
  status TEXT NOT NULL
    CHECK (status IN ('queued', 'downloading', 'verifying', 'publishing', 'completed', 'failed')),
  progress REAL NOT NULL DEFAULT 0
    CHECK (progress >= 0 AND progress <= 100),
  error_code TEXT,
  error_message TEXT,
  song_id TEXT,
  source_video_id TEXT,
  source_title TEXT,
  source_artist TEXT,
  measured_duration_seconds REAL,
  sample_rate_hz INTEGER,
  channels INTEGER,
  bitrate_bits_per_second INTEGER,
  bytes INTEGER,
  created_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS import_jobs_created_at_idx
  ON import_jobs (created_at COLLATE BINARY DESC, id COLLATE BINARY DESC);

ALTER TABLE songs ADD COLUMN audio_sha256 TEXT;
ALTER TABLE songs ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE songs SET updated_at = created_at WHERE updated_at = '';
