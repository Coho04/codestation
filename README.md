<div align="center">
  <img src="assets/logo/render/codestation-256.png" alt="" width="128" height="128">
  <h1>CodeStation</h1>
  <p>
    <strong>Überblick über alle Claude-Code-Projekte und -Sessions — und das Terminal,
    in dem sie laufen.</strong>
  </p>
  <p>
    <a href="https://github.com/Coho04/codestation/releases/latest">
      <img src="https://img.shields.io/github/v/release/Coho04/codestation?label=Release" alt="Neueste Version"></a>
    <a href="https://github.com/Coho04/codestation/actions/workflows/ci.yml">
      <img src="https://github.com/Coho04/codestation/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
    <a href="LICENSE">
      <img src="https://img.shields.io/badge/Lizenz-MIT-blue.svg" alt="MIT"></a>
    <img src="https://img.shields.io/badge/macOS-Apple%20Silicon-black?logo=apple" alt="macOS, Apple Silicon">
  </p>
</div>

---

Claude Code legt seinen gesamten Zustand unter `~/.claude` ab, bietet aber keine
Oberfläche darüber. Wer über viele Projekte hinweg arbeitet, sieht nicht, welche
Session gerade auf eine Antwort wartet, findet nicht wieder, was vor drei Wochen
entschieden wurde, und weiß nicht, was das alles gekostet hat.

CodeStation schließt diese Lücke — und ist zugleich das Terminal, in dem die
Sessions laufen, damit Überblick und Arbeit nicht in zwei Werkzeugen
stattfinden.

Design, Messwerte und Begründungen:
[`docs/specs/2026-10-08-codestation-design.md`](docs/specs/2026-10-08-codestation-design.md).

## Was es tut

- **Überblick** über alle Projekte und Sessions, die Claude Code je angelegt hat
  — auch über die, deren Transcripts Claude Code inzwischen selbst weggeräumt
  hat. Der Index ist ein Archiv, kein Spiegel.
- **Aufräumen** in vier klar getrennten Stufen (siehe unten).
- **Live-Status** jeder laufenden Session, egal wo gestartet: `idle`, `working`
  oder „wartet auf dich“, mit Dock-Badge und Benachrichtigung.
- **Volltextsuche** über Prompts, Antworten, Tool-Aufrufe und Pläne. Umlaute
  werden gefaltet (`prufung` findet `Prüfung`), Pfade und Bezeichner finden sich
  über einen zweiten Index (`"src/app"`, `"handleFooBar"`).
- **Kosten** je Session, Modell und Tag — berechnet aus dem Token-Verbrauch.
- **Terminal**, in dem Claude-Sessions gestartet und fortgesetzt werden.

## Installation

Fertige Ausgaben liegen unter
[**Releases**](https://github.com/Coho04/codestation/releases/latest):
Disk-Image laden, CodeStation in den Programme-Ordner ziehen, starten.

Voraussetzungen: macOS 13 oder neuer auf Apple Silicon, und eine installierte
[Claude Code](https://claude.com/claude-code)-CLI.

> Ist die Ausgabe nicht notarisiert, meldet macOS beim ersten Start, der
> Entwickler lasse sich nicht verifizieren. Die
> **[Installationsanleitung](docs/INSTALL.md)** beschreibt, was dann zu tun ist
> — und beantwortet die Fragen zu Ordner-Freigaben, Datenschutz und
> Deinstallation.

Die App braucht keinerlei Konfiguration: Beim ersten Start liest sie `~/.claude`
ein. Die Projektliste steht nach etwa einer Sekunde, die Sessionliste nach
fünf, der Volltextindex nach etwa fünfzehn.

## Updates

Die Statusleiste unten rechts zeigt die laufende Version. Ein Klick darauf
öffnet die Update-Ansicht, prüft sofort und lässt sich auf „nicht automatisch
prüfen“ stellen. Im Hintergrund wird alle sechs Stunden geprüft, erstmals
dreißig Sekunden nach dem Start.

Wie das Update dann abläuft, hängt davon ab, wie die Ausgabe signiert wurde:

| Ausgabe | Prüfung | Installation |
|---|---|---|
| Notarisiert (Developer ID) | automatisch | lädt im Hintergrund, aktiv nach Neustart |
| Lokal gebaut oder unsigniert | automatisch | Knopf öffnet den Download, Ersetzen von Hand |

Das ist keine Sparvariante, sondern eine Beschränkung von macOS: Squirrel.Mac
prüft die Signatur des heruntergeladenen Bundles, bevor es das laufende ersetzt.
Ohne Developer-ID-Zertifikat schlägt diese Prüfung fehl — ein Knopf, der das
verspricht, würde erst im letzten Moment scheitern. Geprüft wird trotzdem, denn
davon hängt nichts ab.

Geprüft wird gegen die öffentliche GitHub-Releases-API, ohne Token und ohne
Kennung. Ist die Prüfung abgeschaltet, geht keine Anfrage hinaus.

## Aus dem Quellcode bauen

### Voraussetzungen

## Voraussetzungen

Node 24 (in `.node-version` festgeschrieben). Mit fnm:

```bash
fnm use                # oder: fnm install 24 && fnm use 24
npm install            # baut node-pty und better-sqlite3 gegen die Electron-ABI
```

`npm install` ruft über `postinstall` automatisch `electron-builder install-app-deps`.
**Nach jedem Electron-Versionswechsel muss das erneut laufen**, sonst scheitern
die nativen Module beim Start mit `NODE_MODULE_VERSION mismatch`.

### Entwicklung

```bash
npm run dev          # Angular-Dev-Server + esbuild-Watcher + Electron
npm run build        # Produktionsbundles (main, preload, renderer)
npm run package      # .app nach release/ (schnell, für den Eigenbedarf)
npm run package:dist # Disk-Image und ZIP, wie in einem Release
```

`npm run dev` startet Electron neu, wenn sich main oder preload ändern;
Renderer-Änderungen lädt der Dev-Server selbst nach.

### Prüfen

```bash
npm run typecheck
npm run lint         # inklusive der Architektur-Grenzen (siehe unten)
npm test             # Unit- und Repository-Tests
npm run build && npm run test:e2e   # Playwright gegen Electron, mit gefälschtem claude-Binary

# Smoke-Checks gegen die echte Installation bzw. das gepackte Bundle
CS_SMOKE=1     npm run dev                      # startet, prüft die Bridge, beendet sich
CS_SMOKE=index ./node_modules/.bin/electron .   # indiziert ~/.claude und prüft jede Abfrage
CS_SMOKE=pty CS_SMOKE_CWD="$PWD" CS_CLAUDE_BIN="$PWD/test/fixtures/bin/fake-claude" \
  ./node_modules/.bin/electron .                # prüft node-pty
```

Die Smoke-Checks sind kein Zierrat. Ein Build, der kompiliert, aber seine eigene
Bridge nicht erreicht, dessen native Module nicht zur Electron-ABI passen oder
dessen Indexer-Prozess im gepackten Bundle gar nicht erst startet, ist kein
lauffähiger Build — und alle drei Fälle sind beim Bauen dieser App tatsächlich
aufgetreten.

## Logo

Handgezeichnete Vektoren unter `assets/logo/`, keine generierten Bilder. Das
Motiv ist ein Shell-Prompt in einer Sprechblase: ein Gespräch, das im Terminal
stattfindet. Bewusst **kein** Abbild von Anthropics Claude-Bildmarke — das würde
die App als offiziell ausgeben.

Die Maße sind gerechnet, nicht nach Augenmaß gewählt. Zwei Gründe:

**Kleine Größen.** Bei 16 px schrumpft die Zeichenfläche um das 64-fache; ein
Strich von 54 Einheiten landet bei 0,85 px, also unter einem Pixel und damit
unsichtbar. Jedes Element ist so dimensioniert, dass seine kleinste Darstellung
über einem Pixel bleibt.

**Die Kachel.** Der erste Entwurf hatte einen handgeschriebenen Bézier-Pfad, der
640 × 832 spannte — ein stehendes Rechteck statt eines Quadrats, mit 192 px
Seitenrand gegen 96 px oben und unten. Im Dock sah das gequetscht aus. Die
Kachel ist jetzt eine echte Superellipse, erzeugt statt gezeichnet:

    |x/a|^n + |y/a|^n = 1,   a = 412,   n = 5

`n = 5` nähert Apples durchgehende Eckenkrümmung an; 824 von 1024 ist die
macOS-Konvention für eine App-Kachel. Gemessen: 824 × 824 bei Versatz 100/100.
Keine Kontur — macOS-Icons haben keine, und die hier las sich als schmutziger
Rand.

```bash
npm run logo          # SVG → PNG in allen Größen → CodeStation.icns
npm run logo:render   # nur die PNGs
```

Gerendert wird mit Chromium über Electron, nicht mit ImageMagicks
SVG-Renderer: Der ist nur annähernd, und ein Icon, das von seiner Quelle
abweicht, ist schlimmer als keins. Skaliert wird anschließend mit Electrons
eigenem Resampler — ein Werkzeug weniger und eine stille Fehlerquelle weniger.

Zwei Zeichnungen, nicht eine skaliert: `codestation.svg` ist das App-Icon mit
Squircle, `codestation-mark.svg` die Marke für die Titelleiste. Bei 15 px kosten
Squircle und Cursor-Block mehr, als sie geben. Verworfene Entwürfe liegen unter
`assets/logo/alternatives/`.

## Struktur

```
packages/shared     Typen und Verträge, umgebungsfrei (per Lint erzwungen)
packages/main       Electron-Main: Fenster, Security, PTYs, Prozess-Brokering
packages/preload    die einzige Brücke in den Renderer
packages/indexer    utilityProcess: SQLite-Index über ~/.claude
packages/renderer   Angular 22, standalone, Signals, zoneless
```

Drei Grenzen werden per ESLint erzwungen, weil sie sonst erodieren:

- `packages/shared` darf nichts aus `electron` oder `node:*` importieren.
- `packages/renderer` darf nicht in `main` oder `indexer` greifen — er ist eine
  Projektion ihres Zustands, kein zweiter Besitzer davon.
- Der Renderer importiert `electron` nicht; er spricht ausschließlich über
  `window.cs`.

## Aufräumen: vier Stufen

| Aktion | Wirkung | Umkehrbar |
|---|---|---|
| **Archivieren** | Raus aus Listen **und Suche**, Daten bleiben vollständig | ja, ein Klick |
| **Aus dem Index entfernen** | Index-Zeilen weg, `~/.claude` unberührt | ja, im Archiv |
| **Auf der Platte löschen** | Transcript in `~/.claude` wird gelöscht | **nein** |
| **Umbenennen / Gruppieren** | Nur Ordnung | ja |

Erreichbar per Rechtsklick auf ein Projekt in der Sidebar oder auf eine Zeile in
der Sessionliste; alles zusätzlich über die Command-Registry. Die Ansicht
**Archiv** listet Archiviertes und Vergessenes mit Zurückholen-Knopf.

Zwei Unterscheidungen, die die App bewusst offenhält:

- **„Archiviert" ist nicht „Quelle weg".** Ersteres hast du entschieden,
  Letzteres ist passiert, weil Claude Code aufgeräumt hat. Beides zu vermischen
  würde die Frage unbeantwortbar machen, die zählt: *Habe ich das weggelegt,
  oder ist es mir abhandengekommen?*
- **Vergessen braucht Grabsteine.** Ohne eine Tabelle vergessener Pfade holt der
  Reconcile-Sweep alles binnen einer Minute zurück. Die Grabsteine stehen im
  Archiv und lassen sich aufheben; dabei wird auch der Ingest-Cursor gelöscht,
  sonst sähe der Sweep eine unveränderte Datei und überspränge sie für immer.

## Entwurfsentscheidungen, die nicht offensichtlich sind

- **Der Index ist wegwerfbar.** Ein Neuaufbau aus `~/.claude` dauert etwa 15
  Sekunden. Nur selbst erzeugte Daten (Pins, Namen, Gruppen) überleben ihn
  bewusst.
- **Jeder Record mit einer `uuid` ist ein Knoten im Gesprächsbaum** — auch
  `attachment`- und `system`-Zeilen, die inhaltlich nichts beitragen. Lässt man
  sie weg, zerfällt die Kette und der „aktuelle Gesprächsverlauf“ ist leer.
- **„Wartet auf dich“ ist hergeleitet, nicht abgelesen.** `sessions/<pid>.json`
  hat keinen Heartbeat; der mtime des Transcripts dient als Ersatz.
- **Kosten ohne bekannten Preis bleiben leer.** Eine selbstbewusste 0,00 würde
  geglaubt.
- **Claude läuft im Alternate Screen Buffer**, schreibt also keinen Scrollback.
  Die Historie eines Panes ist das Transcript, nicht der Terminalpuffer.

## Hinweise

- **`appId` (`de.mediacologne.codestation`) nicht ändern.** macOS bindet
  TCC-Freigaben für Dokumente/Schreibtisch/Downloads an das Paar
  (appId, Signing-Identity). Eine Änderung entzieht alle Freigaben — auch die,
  die die PTY-Kindprozesse erben.
- Die App liest `~/.claude` lesend, **mit einer Ausnahme**: „Auf der Platte
  löschen" entfernt Transcripts. Das geschieht ausschließlich im Main-Prozess,
  hinter einem nativen Bestätigungsdialog, der Dateianzahl und Größe nennt, und
  nur innerhalb von `~/.claude/projects` — diese Grenze prüft der Main-Prozess
  selbst, unabhängig davon, was der Renderer schickt. Der Indexer bleibt strikt
  lesend.
- `sessions/*.key` (Auth-Token) wird nie geöffnet, `claude project purge` nie
  aufgerufen — es würde auch `~/.claude.json` umschreiben, und die
  Projekt-Registry gehört Claude Code.
- Laufende Sessions enden mit der App. Das Transcript bleibt immer erhalten, und
  jede Session lässt sich fortsetzen; wer eine Session überleben lassen will,
  startet sie im Launch-Dialog mit „weiterlaufen lassen“ (`claude --bg`).

## Mitwirken

Fehlerberichte und Vorschläge sind willkommen — am besten als
[Issue](https://github.com/Coho04/codestation/issues) mit der Version aus der
Statusleiste und der Claude-Code-Version.

Für Pull Requests gilt nur eine Regel, und die prüft die CI ohnehin:

```bash
npm run typecheck && npm run lint && npm test && npm run test:e2e
```

Fixtures werden nie roh aus eigenen Transcripts übernommen, sondern über
`scripts/scrub-fixture.mjs` anonymisiert.

## Lizenz

[MIT](LICENSE).

CodeStation ist ein unabhängiges Projekt und steht in keiner Verbindung zu
Anthropic. „Claude“ und „Claude Code“ sind Marken von Anthropic.
