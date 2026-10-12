#!/usr/bin/env node
/**
 * Harvests one example of every record type found in the real ~/.claude and
 * writes scrubbed copies to test/fixtures/records/.
 *
 * Fixtures from real data are the point: six record types exist on this machine
 * that a careful manual survey of the same installation missed. Hand-written
 * fixtures would only ever contain the shapes we already believed in.
 *
 * Everything identifying or personal is replaced: user paths, account and
 * machine ids, auth tokens, and all free text (prose is swapped for filler of
 * the same length so size-dependent logic still behaves).
 */
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'test/fixtures/records');
const PROJECTS = join(homedir(), '.claude', 'projects');

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const SECRET_KEYS = new Set([
  'ownerAccountUuid', 'ownerOrganizationUuid', 'machineID', 'userID', 'userId',
  'peerToken', 'bridgeSessionId', 'signature', 'oauthAccount', 'accessToken',
  'apiKey', 'email',
]);
const TEXT_KEYS = new Set([
  'text', 'content', 'display', 'aiTitle', 'customTitle', 'description',
  'prompt', 'command', 'summary', 'detail', 'stdout', 'stderr', 'body',
  'message', 'title', 'query', 'result', 'oldString', 'newString', 'originalFile',
]);

const uuidMap = new Map();
const fakeUuid = (seen) => {
  if (!uuidMap.has(seen)) {
    const n = uuidMap.size + 1;
    const hex = n.toString(16).padStart(12, '0');
    uuidMap.set(seen, `00000000-0000-4000-8000-${hex}`);
  }
  return uuidMap.get(seen);
};

const HOME = homedir();
const USER = HOME.split('/').filter(Boolean).pop() ?? 'user';
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// The project directory encoding also carries the username, in dash form
// (`-Users-<name>-Desktop-Project`). Redacting only `/Users/<name>` misses it.
const USER_RE = new RegExp(USER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
const TOKENS_LEFT_RE = /<total_tokens>[\s\S]*?<\/total_tokens>/g;

const FILLER =
  'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ';
const filler = (length) =>
  length <= 0 ? '' : FILLER.repeat(Math.ceil(length / FILLER.length)).slice(0, length);

/** Applied to every string, whatever its key — identity must not depend on a key allow-list. */
const redact = (value) =>
  value
    .replace(UUID_RE, (m) => fakeUuid(m.toLowerCase()))
    .replaceAll(HOME, '/Users/dev')
    .replace(EMAIL_RE, 'dev@example.invalid')
    .replace(USER_RE, 'dev');

function scrub(value, key = '') {
  if (typeof value === 'string') {
    if (SECRET_KEYS.has(key)) return value.length > 24 ? `redacted-${String(value.length)}` : 'redacted';

    // Structural markers the decoders actually parse must survive the filler,
    // otherwise the fixture cannot exercise the code it exists for.
    if (TOKENS_LEFT_RE.test(value)) {
      TOKENS_LEFT_RE.lastIndex = 0;
      return value.replace(TOKENS_LEFT_RE, '<total_tokens>14929458 tokens left</total_tokens>');
    }
    TOKENS_LEFT_RE.lastIndex = 0;

    const cleaned = redact(value);
    if (TEXT_KEYS.has(key) && cleaned.length > 24 && !cleaned.startsWith('/')) {
      return filler(Math.min(cleaned.length, 400));
    }
    // Long free text under any other key is still prose; keep a short prefix only.
    if (cleaned.length > 400) return `${filler(120)}[gekürzt]`;
    return cleaned;
  }
  if (Array.isArray(value)) return value.map((entry) => scrub(entry, key));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.has(k) ? 'redacted' : scrub(v, k);
    }
    return out;
  }
  return value;
}

async function* transcripts() {
  if (!existsSync(PROJECTS)) return;
  for (const dir of await readdir(PROJECTS, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const file of await readdir(join(PROJECTS, dir.name), { withFileTypes: true })) {
      if (file.isFile() && file.name.endsWith('.jsonl')) yield join(PROJECTS, dir.name, file.name);
    }
  }
}

const seen = new Map();
let scanned = 0;

for await (const path of transcripts()) {
  // One pass is enough once every type has an example; most types appear early.
  if (seen.size >= 40 && scanned > 60) break;
  scanned += 1;
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let lines = 0;
  for await (const line of rl) {
    if (++lines > 4000) break;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const type = parsed?.type;
    if (typeof type !== 'string') continue;
    const key = type === 'attachment' ? `attachment.${parsed.attachment?.type ?? 'unknown'}` : type;
    if (seen.has(key)) continue;
    seen.set(key, scrub(parsed));
  }
  rl.close();
}

await mkdir(OUT, { recursive: true });
const index = [...seen.keys()].sort();
for (const [key, record] of seen) {
  await writeFile(join(OUT, `${key.replace(/[^\w.-]/g, '_')}.json`), JSON.stringify(record, null, 2) + '\n');
}
await writeFile(join(OUT, 'index.json'), JSON.stringify(index, null, 2) + '\n');

console.log(`scanned ${scanned} transcripts, captured ${seen.size} record shapes:`);
for (const key of index) console.log(`  ${key}`);
