#!/usr/bin/env electron
/**
 * Renders the SVG logo sources to PNG with Chromium.
 *
 * Deliberately not ImageMagick's SVG renderer: it is approximate, and an icon
 * that differs from its source is worse than no icon. Electron is already a
 * dependency and is the very engine the app draws with, so what comes out here
 * is what the design actually is.
 *
 * Rendering happens once at 1024 and is scaled down afterwards, because macOS
 * refuses to create windows at icon sizes — a 16 px window does not exist.
 */
import { app, BrowserWindow } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = join(ROOT, 'assets/logo');
const OUT_DIR = join(ROOT, 'assets/logo/render');

const MASTER = 1024;
const SIZES = [1024, 512, 256, 128, 64, 32, 16];

const names = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const SOURCES = names.length > 0 ? names : ['codestation'];

let sharedWindow = null;

/**
 * One window for the whole run.
 *
 * Creating and destroying a window per render leaves moments with no window at
 * all, and Electron's default `window-all-closed` behaviour then quits the app
 * mid-loop — which is why earlier versions wrote a different, arbitrary number
 * of files on each run and reported nothing.
 */
function getWindow() {
  if (sharedWindow !== null) return sharedWindow;
  // Shown, but parked off-screen: capturePage() on a hidden transparent window
  // fails intermittently with UnknownVizError because the compositor has
  // nothing to read back from.
  sharedWindow = new BrowserWindow({
    width: MASTER,
    height: MASTER,
    x: -(MASTER + 400),
    y: -(MASTER + 400),
    show: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    useContentSize: true,
    skipTaskbar: true,
    focusable: false,
  });
  return sharedWindow;
}

async function renderMaster(name) {
  const svg = await readFile(join(SOURCE_DIR, `${name}.svg`), 'utf8');
  const html = `<!doctype html><meta charset="utf-8">
    <style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}
    svg{display:block;width:${MASTER}px;height:${MASTER}px}</style>${svg}`;

  const window = getWindow();
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 200));

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const image = await window.webContents.capturePage().catch(() => null);
    if (image !== null && !image.isEmpty()) return image;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`capturePage lieferte kein Bild für ${name}`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  for (const name of SOURCES) {
    const master = await renderMaster(name);

    for (const size of SIZES) {
      // Electron's own resampler rather than a shelled-out converter: one less
      // dependency, one less silent failure mode, and the same image pipeline
      // the app itself uses.
      const scaled = size === MASTER ? master : master.resize({ width: size, height: size, quality: 'best' });
      await writeFile(join(OUT_DIR, `${name}-${size}.png`), scaled.toPNG());
    }
    console.log(`[logo] ${name}: ${SIZES.length} Größen`);
  }
}

/**
 * `app.exit()` terminates immediately and does not flush stdout, which is how an
 * earlier version managed to fail while reporting nothing at all. Giving the
 * stream a tick first is the difference between a diagnosable failure and a
 * mystery.
 */
function finish(code, error) {
  if (error !== undefined) console.error('[logo] FEHLER', error);
  sharedWindow?.destroy();
  sharedWindow = null;
  setTimeout(() => app.exit(code), 50);
}

// Keeps the run alive between renders; without it the default behaviour quits.
app.on('window-all-closed', () => undefined);

app.whenReady().then(
  async () => {
    try {
      await main();
      finish(0);
    } catch (error) {
      finish(1, error);
    }
  },
  (error) => finish(1, error),
);

process.on('unhandledRejection', (error) => finish(1, error));
