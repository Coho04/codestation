export const sql = `
-- Seed prices, in USD per million tokens.
--
-- Deliberately incomplete. Costs are only computed for models whose price is
-- known; for anything else the session keeps a NULL cost and the model is
-- counted under 'price-missing:<model>' in diagnostics, so the UI can say
-- "price unknown" instead of quietly showing 0.00 and being believed.
--
-- Prices are data, not code: correcting one is an UPDATE plus a recompute pass,
-- never a reparse of the transcripts.
INSERT INTO model_price
  (model, effective_from, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_5m_per_mtok, cache_write_1h_per_mtok)
VALUES
  ('claude-3-5-sonnet-20240620', 0, 3.00, 15.00, 0.30, 3.75, 6.00),
  ('claude-3-5-sonnet-20241022', 0, 3.00, 15.00, 0.30, 3.75, 6.00),
  ('claude-3-5-haiku-20241022',  0, 0.80,  4.00, 0.08, 1.00, 1.60),
  ('claude-3-opus-20240229',     0, 15.00, 75.00, 1.50, 18.75, 30.00),
  ('claude-3-haiku-20240307',    0, 0.25,  1.25, 0.03, 0.30, 0.50);

INSERT INTO meta (key, value) VALUES
  ('pricing.note', 'Preise je Modell sind unvollständig. Unbekannte Modelle liefern keine berechneten Kosten, damit keine falschen Zahlen entstehen.');
`;
