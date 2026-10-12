// Verifies node-pty and better-sqlite3 load under the Electron ABI they were
// rebuilt for. A mismatch here is the single most common cause of a white
// window after an Electron version bump.
const { app } = require('electron');

app.on('ready', () => {
  const results = [];
  try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    const fts = db.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS fts5").get();
    const version = db.prepare('SELECT sqlite_version() AS v').get();
    db.close();
    results.push(`better-sqlite3 OK sqlite=${version.v} fts5=${fts.fts5}`);
    if (fts.fts5 !== 1) results.push('better-sqlite3 FAIL FTS5 not compiled in');
  } catch (error) {
    results.push(`better-sqlite3 FAIL ${error.message}`);
  }
  try {
    const pty = require('node-pty');
    const child = pty.spawn('/bin/echo', ['pty-ok'], { name: 'xterm-256color', cols: 80, rows: 24 });
    let out = '';
    child.onData((d) => (out += d));
    child.onExit(() => {
      results.push(`node-pty OK pid=${child.pid} output=${JSON.stringify(out.trim())}`);
      finish(results);
    });
    return;
  } catch (error) {
    results.push(`node-pty FAIL ${error.message}`);
  }
  finish(results);
});

function finish(results) {
  results.forEach((r) => console.log(`[native] ${r}`));
  app.exit(results.some((r) => r.includes('FAIL')) ? 1 : 0);
}
