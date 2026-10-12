export const sql = `
-- ---------------------------------------------------------------------------
-- project
--
-- 'path' (the real absolute cwd) is the identity. 'encoded_dir' is explicitly
-- NOT unique: the directory encoding under ~/.claude/projects replaces '/', '_',
-- '.' and spaces with '-', so 'acme.de' and 'acme-de' map to the same name.
-- Real paths always come from a record's 'cwd' or from the keys of
-- ~/.claude.json .projects, never from decoding a directory name.
-- ---------------------------------------------------------------------------
CREATE TABLE project (
  id                  INTEGER PRIMARY KEY,
  path                TEXT    NOT NULL UNIQUE,
  encoded_dir         TEXT,
  display_name        TEXT,
  group_name          TEXT,
  pinned              INTEGER NOT NULL DEFAULT 0,
  hidden              INTEGER NOT NULL DEFAULT 0,
  in_registry         INTEGER NOT NULL DEFAULT 0,
  path_exists         INTEGER NOT NULL DEFAULT 1,
  first_seen_at       INTEGER NOT NULL,
  last_activity_at    INTEGER,
  session_count       INTEGER NOT NULL DEFAULT 0,
  total_cost_usd      REAL    NOT NULL DEFAULT 0,
  total_input_tokens  INTEGER NOT NULL DEFAULT 0,
  total_output_tokens INTEGER NOT NULL DEFAULT 0,
  total_lines_added   INTEGER NOT NULL DEFAULT 0,
  total_lines_removed INTEGER NOT NULL DEFAULT 0,
  last_session_id     TEXT,
  registry_json       TEXT,
  deep_indexed        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX project_activity ON project(last_activity_at DESC);

-- ---------------------------------------------------------------------------
-- session — denormalised on purpose: the session list is the hottest screen and
-- must render without joins.
-- ---------------------------------------------------------------------------
CREATE TABLE session (
  id                     TEXT PRIMARY KEY,
  project_id             INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  transcript_path        TEXT,
  encoded_dir            TEXT,
  cwd                    TEXT NOT NULL,
  current_cwd            TEXT,
  title                  TEXT,
  title_source           TEXT NOT NULL DEFAULT 'fallback',
  agent_name             TEXT,
  started_at             INTEGER,
  ended_at               INTEGER,
  message_count          INTEGER NOT NULL DEFAULT 0,
  user_prompt_count      INTEGER NOT NULL DEFAULT 0,
  assistant_count        INTEGER NOT NULL DEFAULT 0,
  tool_use_count         INTEGER NOT NULL DEFAULT 0,
  git_branch             TEXT,
  cc_version             TEXT,
  entrypoint             TEXT,
  models_json            TEXT,
  leaf_uuid              TEXT,
  root_uuid              TEXT,
  continued_from_session TEXT,
  continued_from_uuid    TEXT,
  kind                   TEXT NOT NULL DEFAULT 'interactive',
  parent_session_id      TEXT,
  spawn_tool_use_id      TEXT,
  agent_type             TEXT,
  spawn_depth            INTEGER,
  bridge_session_id      TEXT,
  worktree_path          TEXT,
  pr_url                 TEXT,
  pr_number              INTEGER,
  cost_usd               REAL,
  cost_source            TEXT,
  input_tokens           INTEGER NOT NULL DEFAULT 0,
  output_tokens          INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens  INTEGER NOT NULL DEFAULT 0,
  lines_added            INTEGER NOT NULL DEFAULT 0,
  lines_removed          INTEGER NOT NULL DEFAULT 0,
  total_duration_ms      INTEGER,
  api_duration_ms        INTEGER,
  tool_duration_ms       INTEGER,
  index_state            TEXT NOT NULL DEFAULT 'skeleton',
  file_present           INTEGER NOT NULL DEFAULT 1,
  archived_at            INTEGER,
  indexed_at             INTEGER
);
CREATE INDEX session_project_time ON session(project_id, started_at DESC);
CREATE INDEX session_ended        ON session(ended_at DESC);
CREATE INDEX session_parent       ON session(parent_session_id);
CREATE INDEX session_kind         ON session(kind, ended_at DESC);

-- ---------------------------------------------------------------------------
-- message — kept slim; full text lives in message_text so the hot table stays
-- small. byte_offset/byte_length make the original line retrievable by seeking,
-- which is what keeps an 83 MB transcript out of memory.
-- ---------------------------------------------------------------------------
CREATE TABLE message (
  id                  INTEGER PRIMARY KEY,
  session_id          TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  uuid                TEXT NOT NULL,
  parent_uuid         TEXT,
  seq                 INTEGER NOT NULL,
  byte_offset         INTEGER NOT NULL,
  byte_length         INTEGER NOT NULL,
  role                TEXT NOT NULL,
  record_type         TEXT NOT NULL,
  ts                  INTEGER,
  is_meta             INTEGER NOT NULL DEFAULT 0,
  is_sidechain        INTEGER NOT NULL DEFAULT 0,
  -- True only when message.content was a plain string, i.e. typed by a human.
  -- About 8% of 'user' records; the rest are tool results sharing the role.
  is_user_prompt      INTEGER NOT NULL DEFAULT 0,
  on_main_path        INTEGER NOT NULL DEFAULT 0,
  child_count         INTEGER NOT NULL DEFAULT 0,
  prompt_source       TEXT,
  model               TEXT,
  stop_reason         TEXT,
  request_id          TEXT,
  effort              TEXT,
  git_branch          TEXT,
  text_preview        TEXT,
  text_len            INTEGER NOT NULL DEFAULT 0,
  blocks_json         TEXT,
  input_tokens        INTEGER,
  output_tokens       INTEGER,
  cache_read_tokens   INTEGER,
  cache_creation_tokens INTEGER,
  cost_usd            REAL,
  context_tokens_left INTEGER,
  tool_result_for     TEXT
);
-- The safety net that makes the whole byte-offset scheme forgiving: a range
-- read twice is a no-op instead of a duplicate.
CREATE UNIQUE INDEX message_session_uuid ON message(session_id, uuid);
CREATE INDEX message_session_seq  ON message(session_id, seq);
CREATE INDEX message_parent       ON message(session_id, parent_uuid);
CREATE INDEX message_uuid_global  ON message(uuid);
CREATE INDEX message_main         ON message(session_id, seq) WHERE on_main_path = 1;
CREATE INDEX message_prompts      ON message(ts DESC) WHERE is_user_prompt = 1;

CREATE TABLE message_text (
  message_id INTEGER PRIMARY KEY REFERENCES message(id) ON DELETE CASCADE,
  body       TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- tool_use — summaries only. Result bodies are 126 MB of the corpus and are
-- read back from disk on demand instead.
-- ---------------------------------------------------------------------------
CREATE TABLE tool_use (
  id                  INTEGER PRIMARY KEY,
  session_id          TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  message_id          INTEGER NOT NULL REFERENCES message(id) ON DELETE CASCADE,
  tool_use_id         TEXT NOT NULL,
  name                TEXT NOT NULL,
  server              TEXT,
  input_summary       TEXT,
  target_path         TEXT,
  input_bytes         INTEGER,
  result_message_id   INTEGER,
  result_bytes        INTEGER,
  result_is_error     INTEGER NOT NULL DEFAULT 0,
  result_external_path TEXT,
  duration_ms         INTEGER,
  ts                  INTEGER
);
CREATE UNIQUE INDEX tool_use_uid    ON tool_use(session_id, tool_use_id);
CREATE INDEX        tool_use_name   ON tool_use(name);
CREATE INDEX        tool_use_target ON tool_use(target_path);

-- ---------------------------------------------------------------------------
-- costs — only 9% of sessions carry a populated cost-state record, so costs are
-- computed from usage against a price table. Keeping prices as data means a
-- price change is an UPDATE plus a recompute, not a reparse of 510 MB.
-- ---------------------------------------------------------------------------
CREATE TABLE cost_rollup (
  session_id            TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  model                 TEXT NOT NULL,
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  web_search_requests   INTEGER NOT NULL DEFAULT 0,
  cost_usd              REAL NOT NULL DEFAULT 0,
  source                TEXT NOT NULL DEFAULT 'computed',
  PRIMARY KEY (session_id, model)
);

CREATE TABLE cost_daily (
  day           TEXT NOT NULL,
  project_id    INTEGER NOT NULL,
  model         TEXT NOT NULL,
  cost_usd      REAL NOT NULL DEFAULT 0,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  session_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, project_id, model)
);

CREATE TABLE model_price (
  model                   TEXT NOT NULL,
  effective_from          INTEGER NOT NULL,
  input_per_mtok          REAL NOT NULL,
  output_per_mtok         REAL NOT NULL,
  cache_read_per_mtok     REAL NOT NULL,
  cache_write_5m_per_mtok REAL NOT NULL,
  cache_write_1h_per_mtok REAL NOT NULL,
  PRIMARY KEY (model, effective_from)
);

-- ---------------------------------------------------------------------------
-- file_touch / plan — the only hard link from a session to a plan file is a
-- file-history-delta whose trackingPath points into ~/.claude/plans.
-- ---------------------------------------------------------------------------
CREATE TABLE file_touch (
  id               INTEGER PRIMARY KEY,
  session_id       TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  message_id       INTEGER,
  abs_path         TEXT NOT NULL,
  tracking_path    TEXT NOT NULL,
  version          INTEGER,
  backup_file_name TEXT,
  ts               INTEGER NOT NULL
);
CREATE INDEX file_touch_path    ON file_touch(abs_path, ts DESC);
CREATE INDEX file_touch_session ON file_touch(session_id);

CREATE TABLE plan (
  id           INTEGER PRIMARY KEY,
  file_path    TEXT NOT NULL UNIQUE,
  slug         TEXT NOT NULL,
  title        TEXT,
  mtime        INTEGER NOT NULL,
  size         INTEGER NOT NULL,
  content_hash TEXT,
  body         TEXT,
  file_present INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE plan_link (
  plan_id    INTEGER NOT NULL REFERENCES plan(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  method     TEXT NOT NULL,
  confidence REAL NOT NULL,
  PRIMARY KEY (plan_id, session_id)
);

-- ---------------------------------------------------------------------------
-- prompt_history — accumulated, never replaced. history.jsonl is itself pruned
-- by Claude Code, and it is then the only remaining trace of a deleted
-- session's prompts.
-- ---------------------------------------------------------------------------
CREATE TABLE prompt_history (
  id            INTEGER PRIMARY KEY,
  ts            INTEGER NOT NULL,
  project_path  TEXT NOT NULL,
  session_id    TEXT,
  display       TEXT NOT NULL,
  pasted_count  INTEGER NOT NULL DEFAULT 0,
  pasted_bytes  INTEGER NOT NULL DEFAULT 0,
  hash          TEXT NOT NULL
);
CREATE UNIQUE INDEX prompt_history_dedup   ON prompt_history(ts, hash);
CREATE INDEX        prompt_history_project ON prompt_history(project_path, ts DESC);

-- ---------------------------------------------------------------------------
-- ingest_cursor — what keeps an 83 MB file from being re-read on every tick.
-- inode catches replace-by-rename, head_sha256 catches in-place rewrites.
-- ---------------------------------------------------------------------------
CREATE TABLE ingest_cursor (
  path        TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  byte_offset INTEGER NOT NULL DEFAULT 0,
  line_no     INTEGER NOT NULL DEFAULT 0,
  size        INTEGER NOT NULL DEFAULT 0,
  mtime_ms    INTEGER NOT NULL DEFAULT 0,
  inode       TEXT,
  head_sha256 TEXT,
  state       TEXT NOT NULL DEFAULT 'pending',
  error_count INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  last_ok_at  INTEGER
);
CREATE INDEX ingest_cursor_state ON ingest_cursor(state);

-- Forward compatibility. Capped per type so a future high-volume record cannot
-- blow up the database; the full count lives in diagnostics.
CREATE TABLE unknown_record (
  id          INTEGER PRIMARY KEY,
  session_id  TEXT,
  record_type TEXT NOT NULL,
  seq         INTEGER,
  ts          INTEGER,
  raw         TEXT NOT NULL,
  app_version TEXT
);
CREATE INDEX unknown_record_type ON unknown_record(record_type);

CREATE TABLE diagnostics (
  key   TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER
);

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
