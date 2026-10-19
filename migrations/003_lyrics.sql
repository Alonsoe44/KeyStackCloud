CREATE TABLE IF NOT EXISTS song_lyrics (
  song_id TEXT PRIMARY KEY COLLATE BINARY
    REFERENCES songs (id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL
    CHECK (schema_version = 1),
  document_version INTEGER NOT NULL
    CHECK (document_version >= 1),
  audio_sha256 TEXT,
  language TEXT NOT NULL
    CHECK (length(trim(language)) BETWEEN 1 AND 32),
  review_status TEXT NOT NULL
    CHECK (review_status = 'complete'),
  lyrics_json TEXT NOT NULL
    CHECK (length(lyrics_json) BETWEEN 2 AND 2000000),
  created_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS song_lyrics_audio_idx
  ON song_lyrics (audio_sha256 COLLATE BINARY, song_id COLLATE BINARY);
