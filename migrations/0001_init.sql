CREATE TABLE waitlist (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  source      TEXT,
  consent_at  TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT    NOT NULL CHECK (category IN ('bug','idea','other')),
  message     TEXT    NOT NULL,
  contact     TEXT,
  meta_json   TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE features (
  id          TEXT    PRIMARY KEY,
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL,
  status      TEXT    NOT NULL CHECK (status IN ('idea','planned','building','shipped')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE feature_votes (
  feature_id  TEXT    NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  voter_id    TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (feature_id, voter_id)
);

CREATE TABLE stats (
  key         TEXT    PRIMARY KEY,
  value       REAL    NOT NULL DEFAULT 0,
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE error_reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  stage       TEXT    NOT NULL,
  error_name  TEXT    NOT NULL,
  message     TEXT    NOT NULL,
  meta_json   TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_error_reports_created ON error_reports(created_at);

INSERT INTO stats (key, value) VALUES ('clips_exported', 0), ('minutes_processed', 0);
