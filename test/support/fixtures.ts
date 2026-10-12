import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_ROOT = resolve(HERE, '../fixtures');

export const recordFixtureNames = (): string[] =>
  readdirSync(join(FIXTURE_ROOT, 'records'))
    .filter((name) => name.endsWith('.json') && name !== 'index.json')
    .map((name) => name.replace(/\.json$/, ''))
    .sort();

export const readRecordFixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURE_ROOT, 'records', `${name}.json`), 'utf8'));

export const readRecordFixtureText = (name: string): string =>
  JSON.stringify(readRecordFixture(name));
