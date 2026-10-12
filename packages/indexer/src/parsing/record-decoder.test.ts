import { describe, expect, it } from 'vitest';
import { decodeLine, KNOWN_RECORD_TYPES } from './record-decoder.js';
import { readRecordFixture, readRecordFixtureText, recordFixtureNames } from '../../../../test/support/fixtures.js';

const names = recordFixtureNames();

describe('decodeLine against real record shapes', () => {
  it('has fixtures to work with', () => {
    expect(names.length).toBeGreaterThan(20);
  });

  it.each(names)('decodes %s without throwing', (name) => {
    const outcome = decodeLine(readRecordFixtureText(name));
    expect(outcome.parseError).toBe(false);
    expect(outcome.record).not.toBeNull();
  });

  it('recognises every record type present on disk', () => {
    // This is the schema-drift alarm. It is meant to fail the day Claude Code
    // writes something new — that is the signal, not a nuisance.
    const unknown = names
      .map((name) => ({ name, outcome: decodeLine(readRecordFixtureText(name)) }))
      .filter(({ outcome }) => outcome.record?.kind === 'unknown')
      .map(({ name }) => name);
    expect(unknown).toEqual([]);
  });

  it('never throws on malformed input', () => {
    for (const bad of ['', '{', 'null', '[]', '{"no":"type"}', 'not json at all']) {
      expect(() => decodeLine(bad)).not.toThrow();
    }
    expect(decodeLine('{').parseError).toBe(true);
    expect(decodeLine('{"no":"type"}').parseError).toBe(true);
  });

  it('files an unknown record instead of failing on a future type', () => {
    const outcome = decodeLine('{"type":"something-invented-next-year","sessionId":"s1","x":1}');
    expect(outcome.parseError).toBe(false);
    expect(outcome.record).toMatchObject({ kind: 'unknown', recordType: 'something-invented-next-year' });
  });

  it('caps the raw text it keeps for an unknown record', () => {
    const outcome = decodeLine(`{"type":"huge","blob":"${'x'.repeat(50_000)}"}`);
    const record = outcome.record;
    expect(record?.kind).toBe('unknown');
    if (record?.kind === 'unknown') expect(record.raw.length).toBeLessThanOrEqual(8193);
  });

  it('lists the ignored types so they do not trip the drift alarm', () => {
    expect(KNOWN_RECORD_TYPES).toContain('mode');
    expect(KNOWN_RECORD_TYPES).toContain('queue-operation');
    expect(KNOWN_RECORD_TYPES).toContain('assistant');
  });
});

describe('specific decoders', () => {
  it('reads a session title and marks where it came from', () => {
    const record = decodeLine(readRecordFixtureText('ai-title')).record;
    expect(record).toMatchObject({ kind: 'session-meta', titleSource: 'ai-title' });
  });

  it('prefers a user-set title over the generated one', () => {
    const record = decodeLine(readRecordFixtureText('custom-title')).record;
    expect(record).toMatchObject({ kind: 'session-meta', titleSource: 'custom-title' });
  });

  it('extracts the remaining context budget from a token reminder', () => {
    const record = decodeLine(readRecordFixtureText('attachment.total_tokens_reminder')).record;
    expect(record).toMatchObject({ kind: 'attachment', attachmentType: 'total_tokens_reminder' });
    if (record?.kind === 'attachment') expect(record.contextTokensLeft).toBeGreaterThan(0);
  });

  it('keeps nothing but the type from a bulky attachment', () => {
    const record = decodeLine(readRecordFixtureText('attachment.skill_listing')).record;
    expect(record).toMatchObject({ kind: 'attachment', contextTokensLeft: null });
  });

  it('reads the resume pointer', () => {
    const record = decodeLine(readRecordFixtureText('last-prompt')).record;
    expect(record).toMatchObject({ kind: 'session-meta', recordType: 'last-prompt' });
    if (record?.kind === 'session-meta') expect(record.leafUuid).toBeTruthy();
  });

  it('reads a cost-state even when its totals are zero', () => {
    // 31 of 359 sessions have one at all, and many of those are zeroed — which
    // is exactly why costs are computed from usage rather than read from here.
    const record = decodeLine(readRecordFixtureText('cost-state')).record;
    expect(record?.kind).toBe('cost-state');
    if (record?.kind === 'cost-state') {
      expect(typeof record.totalCostUsd).toBe('number');
      expect(record.modelUsage).toBeInstanceOf(Map);
    }
  });

  it('links a file-history delta to the path it tracked', () => {
    const record = decodeLine(readRecordFixtureText('file-history-delta')).record;
    expect(record?.kind).toBe('file-history');
    if (record?.kind === 'file-history') expect(record.trackingPath.length).toBeGreaterThan(0);
  });

  it('decodes a user record and reports whether a human typed it', () => {
    const raw = readRecordFixture('user') as { message?: { content?: unknown } };
    const record = decodeLine(JSON.stringify(raw)).record;
    expect(record?.kind).toBe('message');
    if (record?.kind === 'message') {
      expect(record.role).toBe('user');
      expect(record.isUserPrompt).toBe(typeof raw.message?.content === 'string');
    }
  });

  it('decodes an assistant record with its usage figures', () => {
    const record = decodeLine(readRecordFixtureText('assistant')).record;
    expect(record?.kind).toBe('message');
    if (record?.kind === 'message') {
      expect(record.role).toBe('assistant');
      expect(record.usage).not.toBeNull();
      expect(record.model).toBeTruthy();
    }
  });
});
