-- SQLite schema for the method-of-loci memory layer.
-- Wings are the top-level partition (e.g. "work", "personal"); halls are broad topics
-- (e.g. "Acme account", "Q2 close"); rooms are specific contexts within a hall
-- (e.g. "discovery calls", "contract redlines"). memory_facts live inside rooms and
-- carry a pointer into the Chroma collection for vector recall.

CREATE TABLE IF NOT EXISTS wings (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS halls (
  id         TEXT PRIMARY KEY,
  wing_id    TEXT NOT NULL REFERENCES wings(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rooms (
  id         TEXT PRIMARY KEY,
  hall_id    TEXT NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memory_facts (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  room_id        TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  content        TEXT NOT NULL,
  salience       REAL NOT NULL DEFAULT 0.5,   -- 0..1, gates L1 inclusion
  embedding_ref  TEXT,                          -- Chroma doc id
  written_at     TEXT NOT NULL DEFAULT (datetime('now')),
  visible        INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS memory_facts_tenant_idx ON memory_facts(tenant_id, written_at DESC);
CREATE INDEX IF NOT EXISTS memory_facts_room_idx   ON memory_facts(room_id);
