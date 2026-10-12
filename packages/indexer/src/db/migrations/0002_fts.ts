export const sql = `
-- Two tokenisers over the same text, because one cannot serve both needs.
--
-- unicode61 with remove_diacritics folds ä→a, ö→o, ü→u, which is what German
-- prose searching needs. Known gap: it does not fold ß→ss; the query
-- normaliser handles that on both sides instead of distorting the tokeniser.
--
-- '_' is a token character so snake_case stays one token. '.' and '/' are
-- deliberately NOT, because 'src/app/foo.ts' would become a single token and a
-- search for 'foo' would miss it. Path and identifier substring matching is the
-- trigram index's job — the case unicode61 cannot solve in principle.
--
-- Both use external content: the text lives once in message_text.
CREATE VIRTUAL TABLE fts_message USING fts5(
  body,
  content='message_text',
  content_rowid='message_id',
  tokenize = "unicode61 remove_diacritics 2 tokenchars '_'"
);

CREATE VIRTUAL TABLE fts_message_tri USING fts5(
  body,
  content='message_text',
  content_rowid='message_id',
  tokenize = 'trigram'
);

-- External-content tables need explicit maintenance; triggers keep them honest
-- even when rows are deleted by a cascade we did not write by hand.
CREATE TRIGGER message_text_ai AFTER INSERT ON message_text BEGIN
  INSERT INTO fts_message(rowid, body)     VALUES (new.message_id, new.body);
  INSERT INTO fts_message_tri(rowid, body) VALUES (new.message_id, new.body);
END;

CREATE TRIGGER message_text_ad AFTER DELETE ON message_text BEGIN
  INSERT INTO fts_message(fts_message, rowid, body)         VALUES ('delete', old.message_id, old.body);
  INSERT INTO fts_message_tri(fts_message_tri, rowid, body) VALUES ('delete', old.message_id, old.body);
END;

CREATE TRIGGER message_text_au AFTER UPDATE ON message_text BEGIN
  INSERT INTO fts_message(fts_message, rowid, body)         VALUES ('delete', old.message_id, old.body);
  INSERT INTO fts_message_tri(fts_message_tri, rowid, body) VALUES ('delete', old.message_id, old.body);
  INSERT INTO fts_message(rowid, body)     VALUES (new.message_id, new.body);
  INSERT INTO fts_message_tri(rowid, body) VALUES (new.message_id, new.body);
END;

-- Plans are few (120 KB total) but are prose worth finding.
CREATE VIRTUAL TABLE fts_plan USING fts5(
  title, body,
  tokenize = "unicode61 remove_diacritics 2 tokenchars '_'"
);

-- history.jsonl survives transcripts being pruned, so its prompts stay findable
-- even when the session they belonged to is gone.
CREATE VIRTUAL TABLE fts_prompt_history USING fts5(
  display,
  content='prompt_history',
  content_rowid='id',
  tokenize = "unicode61 remove_diacritics 2 tokenchars '_'"
);

CREATE TRIGGER prompt_history_ai AFTER INSERT ON prompt_history BEGIN
  INSERT INTO fts_prompt_history(rowid, display) VALUES (new.id, new.display);
END;

CREATE TRIGGER prompt_history_ad AFTER DELETE ON prompt_history BEGIN
  INSERT INTO fts_prompt_history(fts_prompt_history, rowid, display) VALUES ('delete', old.id, old.display);
END;
`;
