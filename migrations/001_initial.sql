CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY COLLATE BINARY
    CHECK (length(id) BETWEEN 1 AND 200),
  title TEXT NOT NULL
    CHECK (length(trim(title)) BETWEEN 1 AND 500),
  artist TEXT NOT NULL
    CHECK (length(trim(artist)) BETWEEN 1 AND 500),
  album TEXT
    CHECK (album IS NULL OR length(trim(album)) BETWEEN 1 AND 500),
  duration_seconds REAL NOT NULL
    CHECK (duration_seconds > 0 AND duration_seconds <= 86400),
  file_path TEXT NOT NULL UNIQUE
    CHECK (length(file_path) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS songs_title_artist_idx
  ON songs (title COLLATE NOCASE, artist COLLATE NOCASE, id COLLATE BINARY);
