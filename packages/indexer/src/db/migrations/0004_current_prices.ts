export const sql = `
-- Current Anthropic first-party rates, USD per million tokens.
--
-- Input and output are the published per-model list prices. The cache columns
-- are derived from the documented multipliers rather than quoted per model:
-- a 5-minute cache write costs ~1.25x input, a 1-hour write ~2x, and a cache
-- read ~0.1x. They are stored as absolute numbers so a future correction is a
-- single UPDATE, with no arithmetic hidden in code.
--
-- Partner platforms (Bedrock, Vertex) bill separately and are not covered here.
INSERT OR REPLACE INTO model_price
  (model, effective_from, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_5m_per_mtok, cache_write_1h_per_mtok)
VALUES
  ('claude-opus-5',               0, 5.00, 25.00, 0.50, 6.25, 10.00),
  ('claude-opus-4-8',             0, 5.00, 25.00, 0.50, 6.25, 10.00),
  ('claude-opus-4-7',             0, 5.00, 25.00, 0.50, 6.25, 10.00),
  ('claude-opus-4-6',             0, 5.00, 25.00, 0.50, 6.25, 10.00),
  ('claude-sonnet-5',             0, 2.00, 10.00, 0.20, 2.50,  4.00),
  ('claude-sonnet-4-6',           0, 3.00, 15.00, 0.30, 3.75,  6.00),
  ('claude-haiku-4-5',            0, 1.00,  5.00, 0.10, 1.25,  2.00),
  ('claude-haiku-4-5-20251001',   0, 1.00,  5.00, 0.10, 1.25,  2.00),
  ('claude-fable-5',              0, 10.00, 50.00, 1.00, 12.50, 20.00),
  ('claude-fable-5-1',            0, 10.00, 50.00, 0.25, 12.50, 20.00),
  -- Not a model: Claude Code records synthetic turns under this name. Priced at
  -- zero so it stops showing up as a missing price.
  ('<synthetic>',                 0, 0.00,  0.00, 0.00, 0.00,  0.00);

UPDATE meta SET value = 'Preise je Modell in USD pro Million Token. Unbekannte Modelle liefern bewusst keine berechneten Kosten.'
WHERE key = 'pricing.note';
`;
