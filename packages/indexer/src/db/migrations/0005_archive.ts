export const sql = `
-- 'hidden' and an archive flag would both mean "out of the list", and nobody can
-- tell two such states apart. One concept: archived means out of the lists and
-- out of full-text search.
ALTER TABLE project RENAME COLUMN hidden TO archived;
ALTER TABLE project ADD COLUMN archived_at INTEGER;

-- Deliberately separate from file_present, which means "Claude Code removed the
-- source". Merging them would make the one question that matters unanswerable:
-- did I put this away, or did I lose it?
ALTER TABLE session ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE session ADD COLUMN user_archived_at INTEGER;

CREATE INDEX session_archived ON session(archived);

-- Without these, "remove from the index" would be undone by the next reconcile
-- sweep within a minute. A tombstone is what makes forgetting stick — and it is
-- listed in the archive view so it can be taken back.
CREATE TABLE tombstone (
  path       TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  label      TEXT,
  session_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX tombstone_kind ON tombstone(kind, created_at DESC);
`;
