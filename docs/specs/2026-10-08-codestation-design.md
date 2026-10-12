# CodeStation — Claude Code Management Terminal

## Context

Der Nutzer arbeitet täglich mit Claude Code über 38 Projekte hinweg — 359 Session-Transcripts, 510 MB, teils mehrere Sessions parallel in PhpStorm-Terminals, iTerm und als Background-Jobs. Claude Code legt all seinen State unter `~/.claude` ab, bietet aber keine Oberfläche darüber:

- Kein Überblick, welche Projekte es gibt und was zuletzt passiert ist.
- Keine Möglichkeit zu sehen, welche laufende Session gerade auf eine Antwort wartet — bei parallelen Sessions der teuerste Zeitfresser.
- Keine Suche über das, was in vergangenen Sessions entschieden wurde.
- Kein Ort für offene Punkte eines Projekts.

**CodeStation** schließt diese Lücke und wird zugleich das Terminal, in dem die Sessions laufen — damit Überblick und Arbeit nicht in zwei Werkzeugen stattfinden.

---

## Zerlegung

| # | Teilprojekt | Inhalt | Dieser Plan |
|---|---|---|---|
| **A** | Index-Kern | `~/.claude` einlesen, SQLite-Index, Watcher, Live-Status | ✅ |
| **B** | Dashboard & Archiv | Electron+Angular, Projektliste, Session-Detail, Volltextsuche | ✅ |
| **C** | Terminal v1 | node-pty + xterm.js, Tabs, Sessions starten/resumen | ✅ |
| **D** | Offene Fragen | Blocker, unbeantwortete Fragen, Pläne/TODOs, Notizen | eigener Plan |
| **E** | Terminal-Ausbau | Splits, freie Shell-Tabs, Profile | eigener Plan |

Das Zielbild bleibt der vollwertige Terminal-Ersatz. Die Architektur in C ist so geschnitten, dass E keine Neuschreibung erzwingt (siehe *Terminal-Abstraktion*).

## Entscheidungen

| Frage | Entscheidung |
|---|---|
| Stack | Electron 44 + Angular 22, TypeScript strict |
| Node | **24 LTS, projektlokal via fnm** (`.node-version`) — Angular 22 fordert ≥ 22.22.3, Electron 44 fordert ≥ 22.12; vorhanden sind 20.20.2 |
| Fremde Sessions | Historie **und** Live-Status, egal wo gestartet |
| IPC-Socket zu laufenden Sessions | Nicht in v1, `*.key`-Dateien werden nie geöffnet |
| Archiv | **Echtes Archiv.** Nie `DELETE` — verschwundene Quelldateien werden als `file_present = 0` markiert, Daten bleiben |
| Kosten | Pro Session und Projekt, berechnet aus `usage` + Preistabelle |
| Navigation | Sidebar; alle Aktionen als Command-Objekte modelliert, ⌘K-Palette später als zweite Oberfläche darauf |
| Startansicht | Dashboard |
| Git | Nur was in den Daten steht (`gitBranch`, `file-history-delta`). Keine `git`-Aufrufe |
| Notifications | App benachrichtigt, `inputNeededNotifEnabled` in Claude auf `false` setzen |
| Background-Sessions | `--bg` als Toggle im Launch-Dialog, Default aus |
| Projektliste | Automatisch aus `~/.claude.json`, manuell kuratierbar (pin/rename/gruppieren/ausblenden), fremde Ordner hinzufügbar |
| Name | **CodeStation**, `appId: de.mediacologne.codestation` — nach dem ersten signierten Build **nie mehr ändern** (TCC hängt daran) |

---

## Datenlage (vollständig vermessen, Claude Code 2.1.277)

Vollscan über `~/.claude/projects`: 585 `.jsonl`, 509,7 MB, 129.948 Zeilen, 0 kaputte Zeilen, längste Zeile 1,33 MB. Parsen aller 510 MB dauert ~2,9 s — **Parsen ist nicht der Flaschenhals, SQLite-Writes sind es.**

### Harte Invarianten
- **359 Session-Transcripts + 226 Subagent-Transcripts.** Jede Datei hat genau eine `sessionId`, 0 Ausnahmen.
- `isSidechain` ist in allen Haupt-Transcripts `false`. Subagents existieren ausschließlich als eigene Dateien `<sessionId>/subagents/agent-*.jsonl` + `.meta.json` → als Child-Session modellieren, verknüpft über `toolUseId`, **nicht** als Inline-Flag.
- 140 Fork-Punkte (ein `parentUuid` mit mehreren Kindern). **47 Dateien haben keinen Wurzelknoten** — ihre Kette beginnt in einer anderen Datei (Resume/Compact). Es ist ein **Wald mit dateiübergreifenden Kanten**.

### Was Volumen hat und was Wert hat
| Inhalt | Volumen | Entscheidung |
|---|---|---|
| Echte User-Prompts, Assistant-Text, Titel | **16,3 MB** | FTS Tier 1 |
| `tool_use.input` → nur `command`/`file_path`/`pattern`/`description` | 23,4 MB roh → ~4 MB Summary | FTS Tier 2 |
| `tool_result`-Bodies | 126 MB | Tier 3, **aus**, pro Projekt zuschaltbar |
| `thinking`-Blöcke | 38,7 MB JSON, davon **0,01 MB echter Text** — der Rest sind ~3 KB Base64-Signaturen | **nie** |
| `user.toolUseResult` | 142,5 MB — exaktes Duplikat des `message`-Inhalts derselben Zeile | **nie beides speichern** |
| `attachment`-Bodies | 50 MB (`skill_listing`, `prompt_snapshot`, `total_tokens_reminder`) | nur Rest-Kontextbudget extrahieren |

### Weitere Messergebnisse mit Konsequenz
- **`cost-state` ist nur in 31 von 359 Sessions gefüllt** (9 %), oft `totalCostUSD: 0`. → Kosten aus `assistant.usage` + Preistabelle **rechnen**, `cost-state` nur als Override.
- **28 verschiedene `type`-Werte**, darunter `agent-name`, `history-suppression`, `frame-link`, `artifact-autoreact-ledger`, `artifact-comment-monitor`, `custom-title` — die ein erster, sorgfältiger Scan derselben Installation nicht fand. Dazu undokumentierte Felder `assistant.wireToolInputs` (7,4 MB), `assistant.apiBlockIndex`, `assistant.session_id` neben `sessionId`. **Schema-Drift passiert bereits innerhalb einer Version.**
- **`ps -o lstart=` braucht zwingend `LC_ALL=C TZ=UTC`.** Ohne: `Do.  3 Sep. 09:35:35 2026` statt `Thu Sep  3 07:35:35 2026` — andere Sprache *und* andere Zeitzone. Die Stale-Detection scheitert sonst stumm und meldet alles als tot.
- **`sessions/<pid>.json` hat keinen Heartbeat.** PID 11554 läuft seit 3. September, `statusUpdatedAt` ist vom 23. September. Einträge toter Prozesse bleiben wochenlang liegen. → **Ersatz-Heartbeat ist der mtime des Transcripts**, der ohnehin im Cursor steht.
- `claude agents --json --all` liefert Background-Agents mit `state: "failed"`, die **keinen** Eintrag in `sessions/` haben → zweite Pflichtquelle, kein Fallback.
- Verzeichnisnamen beginnen mit `-`. Jeder Shell-Aufruf braucht `--` oder `./`-Präfix, sonst werden sie als Flags gelesen.
- Nachbarverzeichnisse: `skills/` **1,1 GB**, `plugins/` 294 MB, `security/` 243 MB, `backups/` bekommt **minütlich** eine neue Datei. Ein rekursiver Watcher auf `~/.claude` ist die größte Thrashing-Falle des Projekts.
- **Verzeichniskodierung ist nicht injektiv** (`acme.de` vs. `acme-de`). Echte Pfade kommen aus `cwd` eines Records oder den Keys von `~/.claude.json .projects` — **nie** aus Dekodierung.
- **`tui: "fullscreen"`** in den Settings → Claude läuft im Alternate Screen Buffer, schreibt **keinen Scrollback**. Terminal-Buffer-Persistenz für Claude-Panes wäre wirkungslos; die Historie dieser Panes *ist* das Transcript.
- **12 von 38 Projekt-Roots liegen unter `~/Documents`, `~/Desktop`, `~/Downloads`** → TCC betrifft dieses Projekt real, inklusive Vererbung an den PTY-Kindprozess.

---

## Architektur

### Prozessmodell

```
Main                Fenster, Menü, Lifecycle, PTYs, Port-Brokering. Keine DB.
 └─ utilityProcess  "indexer" — alleiniger Besitzer der SQLite-Connection
Renderer (Angular)  kein fs, kein node, kein sqlite. contextIsolation + sandbox
```

`utilityProcess.fork()` statt Worker-Thread oder Main: `better-sqlite3` ist synchron, ein 8-MB-Batch-Insert im Main würde die Fenster-IPC blockieren. Der Utility-Prozess ist crash-isoliert und neustartbar — Index weg ≠ App weg.

**Transport:** `MessageChannelMain`. Main erzeugt den Kanal und reicht einen Port per `webContents.postMessage` an den Renderer; danach sprechen Renderer und Indexer direkt, Main ist nicht im heißen Pfad. Preload darf einen `MessagePort` nicht über `contextBridge` reichen — es hält den Port und exponiert eine getypte Funktions-API.

PTYs leben im **Main**, nicht im Indexer: node-pty braucht den Window-Lifecycle, und der Indexer soll neustartbar bleiben, ohne Terminals zu killen.

### Projektstruktur

npm-Workspaces, kein Nx (eine App, vier Pakete — Nx löst hier nichts).

```
codestation/
  package.json            workspaces; native deps (node-pty, better-sqlite3) als ROOT-dependencies
  .node-version           24
  tsconfig.base.json      paths → @cs/shared etc.
  electron-builder.yml
  scripts/dev.mjs         ng serve + esbuild watch + electron, ein Script
  docs/specs/             dieser Plan, als Spec eingecheckt
  packages/
    shared/               nur Typen, null Runtime-Deps
      src/contracts/{index-api,terminal-api,events,rpc}.ts
      src/domain/{project,session,message,tool-use,live-session,terminal}.ts
      src/result.ts       Result<T,E> — Fehler als Werte, kein throw über Prozessgrenzen
      src/brand.ts        App-Name + Bundle-ID, die eine Stelle zum Umbenennen
    main/
      src/{main,app/bootstrap,app/single-instance,window/main-window}.ts
      src/security/{csp,navigation-guard,app-protocol}.ts
      src/indexer-host.ts         fork + Port-Brokering + Restart
      src/terminal/{pty-manager,pty-port,node-pty-adapter,output-coalescer,
                    flow-control,pane-registry,argv-builder,profile-resolver}.ts
      src/runtime/{claude-binary-resolver,shell-env-resolver,cli-capabilities}.ts
      src/notify/{badge-service,notification-service}.ts
      src/persistence/workspace-store.ts
    preload/
      src/{preload,rpc-client}.ts
    indexer/
      src/{main,composition-root}.ts
      src/ports/{clock,file-system,process-probe,cli-probe,watcher}.ts
      src/adapters/{system-clock,node-file-system,ps-process-probe,
                    exec-claude-cli,fs-recursive-watcher}.ts
      src/db/{connection,migrator}.ts  src/db/migrations/*.sql  src/db/repositories/*.ts
      src/parsing/{jsonl-line-reader,record-decoder,content-blocks,
                   text-extraction,tool-input-summary}.ts  src/parsing/records/*.ts
      src/ingest/{file-cursor,transcript-ingestor,skeleton-ingestor,ingest-scheduler,
                  claude-json-ingestor,history-ingestor,plans-ingestor,
                  subagent-ingestor,jobs-ingestor,session-linker}.ts
      src/live/{live-session-source,stale-detector,cli-reconciler,jobs-source,
                live-status-service,attention-rules}.ts
      src/watch/{watch-roots,coalescing-queue,change-router,reconcile-sweep}.ts
      src/tree/{tree-builder,main-path}.ts
      src/api/{request-handlers,event-publisher}.ts
    renderer/             eigener Angular-Workspace, angular.json
```

`composition-root.ts` ist die einzige Datei mit `new` — alles Unreine ist ein Port. Eine ESLint-Boundary-Regel verbietet Importe aus `indexer/**` in `renderer/**` (nur `shared/**`).

### Build

**`@angular/build` + esbuild + electron-builder** — bewusst **nicht** electron-vite.

electron-vite ist ein Vite-Wrapper und erwartet Vite-native Frameworks. Angular 22 baut intern auf esbuild, aber über den eigenen `@angular/build:application`-Builder, nicht als Vite-Plugin-Pipeline. Man bräuchte `@analogjs/vite-plugin-angular` — Third-Party, hinkt Angular-Releases hinterher, eigene Fehlerklasse. Man gewänne eine Config-Datei und verlöre den gesegneten Angular-Pfad.

- **Renderer**: Dev `ng serve --port 4200`, Main lädt `http://localhost:4200`. Prod `ng build` → Main lädt `app://-/index.html`. `baseHref: "./"`.
- **Main + Preload**: je eine ~20-zeilige `esbuild.config.mjs`, `platform: node`, `format: cjs`, `external: ['electron','node-pty','better-sqlite3']`. Preload zwingend CJS — ESM-Preloads sind in sandboxed Renderern weiterhin eine Fehlerquelle.
- **`scripts/dev.mjs`** ersetzt `concurrently` + `wait-on` + `cross-env` durch ~40 Zeilen: ng serve starten, per TCP-Poll auf 4200 warten, esbuild im Watch-Modus, Electron starten, bei Main-Rebuild neu starten.

**Native Module** — der Teil, der sonst Tage kostet:
1. `node-pty` und `better-sqlite3` stehen in der **Root-`package.json` unter `dependencies`**, alles andere unter `devDependencies`. electron-builder packt genau die Root-`dependencies`; aus Workspace-Paketen gehoistete Deps erkennt es nicht als App-Deps.
2. `"postinstall": "electron-builder install-app-deps"` → kompiliert gegen die Electron-Header. Electron-Version **exakt gepinnt**, kein `^`.
3. Kein `runtime=electron` in `.npmrc` — das würde den Workspace-Install der Dev-Tools mit vergiften. Der postinstall ist zielgenauer.
4. `asarUnpack` für beide Module, sonst laden die `.node`-Dateien nicht aus dem Archiv.
5. **ABI-Falle**: Nach `install-app-deps` ist `node-pty` für plain `node` unbrauchbar. Darum laufen **keine Unit-Tests gegen echte Native-Module** — alles hinter `PtyPort`; echte PTY-Tests via Playwright in Electron.

**Packaging/Signing** für Eigenbedarf: `mac.target: dir`, `arch: [arm64]`. Signieren mit der vorhandenen **„Apple Development"-Identity** — nicht wegen Gatekeeper (lokal gebaute Apps haben kein Quarantine-Flag), sondern weil macOS **TCC-Freigaben an (Bundle-ID, Signing-Identity)** bindet. Ad-hoc signiert erzeugt jeder Build einen neuen cdhash → Ordner-Freigaben müssten nach jedem Rebuild neu erteilt werden. `extendInfo` braucht `NSDocumentsFolderUsageDescription`, `NSDesktopFolderUsageDescription`, `NSDownloadsFolderUsageDescription` — **ohne diese Strings fragt macOS gar nicht erst, sondern verweigert still mit `EPERM`**. Weglassen: Notarization, Developer-ID, Hardened Runtime, Auto-Update, universal-Build, Fuses.

### Contracts

Eine Quelle der Wahrheit, Compiler erzwingt Vollständigkeit:

```ts
// packages/shared/src/contracts/index-api.ts
export interface IndexApi {
  listProjects(q?: ProjectQuery): Promise<ProjectSummary[]>;
  getProject(id: ProjectId): Promise<ProjectDetail | null>;
  listSessions(q: SessionQuery): Promise<Page<SessionSummary>>;
  getSession(id: SessionId): Promise<SessionDetail | null>;
  getMainPath(id: SessionId, page: PageSpec): Promise<Page<MessageRow>>;
  getSessionTree(id: SessionId): Promise<SessionTree>;
  getRawLine(id: SessionId, messageId: number): Promise<string | null>;   // via byte_offset
  getToolResult(toolUseId: string): Promise<ToolResultBody | null>;       // lazy, ggf. tool-results/*.txt
  search(q: SearchQuery): Promise<Page<SearchHit>>;
  getLiveSessions(): Promise<LiveSession[]>;
  getProgress(): Promise<IndexProgress>;
  rebuildIndex(): Promise<void>;
}
```

```ts
// packages/shared/src/contracts/events.ts
export type AppEvent =
  | { type: 'index.progress';      progress: IndexProgress }
  | { type: 'session.appeared';    session: SessionSummary }
  | { type: 'session.updated';     sessionId: SessionId; messageCount: number; lastTs: number }
  | { type: 'live.changed';        sessions: LiveSession[] }
  | { type: 'pane.state';          paneId: PaneId; state: PaneState }
  | { type: 'pane.bound';          paneId: PaneId; pid: number; sessionId: SessionId }
  | { type: 'pane.exit';           paneId: PaneId; exitCode: number; signal?: number }
  | { type: 'runtime.changed';     info: ClaudeBinaryInfo };
```

`createRpcClient<IndexApi>(port)` erzeugt per Proxy ein Objekt, das `IndexApi` *ist* — keine String-Channel-Namen im Code. Zwei erzwungene Regeln: alle Payloads structured-cloneable (**epoch ms als `number`, nie `Date`**), und Fehler als `Result<T, AppError>` statt `throw` (Electron plattet Error-Objekte über IPC auf `message`, aber die App braucht Codes wie `CLAUDE_NOT_FOUND`, `CWD_MISSING`, `TCC_DENIED`).

Terminal-Queries laufen über den klassischen `ipcRenderer.invoke`-Pfad zum Main; beide Oberflächen liegen hinter **einem** `window.api`.

### Index-Schema

SQLite via `better-sqlite3`, `app.getPath('userData')/index.db`, Modus 0600.
Pragmas: `journal_mode=WAL, synchronous=NORMAL, foreign_keys=ON, temp_store=MEMORY, cache_size=-64000, mmap_size=268435456, busy_timeout=5000`.

Kerntabellen — Details in `db/migrations/0001_init.sql`:

- **`project`** — `path` (echter cwd) ist die Identität und UNIQUE. **`encoded_dir` ist bewusst NICHT UNIQUE**, weil die Kodierung kollidiert. Denormalisiert: `last_activity_at`, `session_count`, `total_cost_usd`. Dazu `pinned`, `hidden`, `group_name`, `display_name` für die manuelle Kuratierung.
- **`session`** — stark denormalisiert, weil die Session-Liste der heißeste Screen ist und ohne Join rendern muss: Titel (`custom-title` > letztes `ai-title` > Prompt-Slug), Zeiten, Zähler, Tokens, Kosten, `git_branch`, `cc_version`, `leaf_uuid`, `root_uuid`, `continued_from_uuid`, `kind` (`interactive|background|subagent`), `parent_session_id`, `spawn_tool_use_id`, `index_state` (`skeleton|partial|complete|error`), **`file_present`**, `archived_at`.
- **`message`** — schlank (~130k Zeilen), Volltext ausgelagert nach `message_text`. Entscheidend: `byte_offset` + `byte_length` (Rohzeile jederzeit nachladbar, ohne die 83-MB-Datei zu öffnen), `seq` (stabile Fallback-Ordnung), **`is_user_prompt`** (`message.content` ist ein String — das Flag, das die 8 % echter Eingaben von den 92 % Tool-Rückläufen trennt), `on_main_path`, `child_count`.
  `UNIQUE(session_id, uuid)` + `ON CONFLICT DO NOTHING` ist das Sicherheitsnetz, das das gesamte Offset-Verfahren fehlertolerant macht: ein doppelt gelesener Bereich ist folgenlos.
- **`tool_use`** — `input_summary` (≤512 Zeichen: `command` / `file_path` / `pattern` / `description`), `target_path`, `result_bytes`, `result_external_path`. **Keine Result-Bodies.**
- **`cost_rollup`** (Session × Modell), **`cost_daily`** (materialisiert fürs Dashboard), **`model_price`** als *Tabelle*: Weil 91 % der Sessions keine `cost-state` haben, werden Kosten gerechnet — eine Preisänderung ist dann ein `UPDATE` + Recompute-Pass, **ohne Reparse der 510 MB**.
- **`file_touch`**, **`plan`** (Body mitspeichern, 120 KB gesamt), **`plan_link`** mit `confidence` (1.0 via `file-history-delta.trackingPath` — verifiziert, dass dort echte Plan-Pfade stehen; 0.5 via mtime-Fenster).
- **`prompt_history`** aus `history.jsonl`, **akkumulierend** mit Dedup über `(ts, hash)` — nicht ersetzend, weil auch `history.jsonl` beschnitten wird und sie dann die einzige Spur gelöschter Sessions ist.
- **`ingest_cursor`** — `byte_offset`, `size`, `mtime_ms`, `inode` ("dev:ino", erkennt Replace-by-Rename), `head_sha256` (erste 64 KiB, erkennt In-Place-Rewrite).
- **`unknown_record`** — Vorwärtskompatibilität, **gedeckelt auf 50 Zeilen je unbekanntem Typ** (Zähler bleibt vollständig), sonst sprengt ein künftiger Hochvolumen-Typ die DB.

### Volltextsuche

Zwei FTS5-Tabellen über denselben Text (`content=''`-external-content, Text liegt nur einmal in `message_text`):

```sql
CREATE VIRTUAL TABLE fts_message USING fts5(
  body, content='message_text', content_rowid='message_id',
  tokenize = "unicode61 remove_diacritics 2 tokenchars '_'");

CREATE VIRTUAL TABLE fts_message_tri USING fts5(
  body, content='message_text', content_rowid='message_id', tokenize = 'trigram');
```

- `remove_diacritics 2` faltet `ä→a, ö→o, ü→u`. **Bekannte Lücke: `ß` wird nicht zu `ss`** — das wird in der Query-Normalisierung beidseitig ergänzt, nicht im Tokenizer.
- `tokenchars '_'` hält `snake_case` zusammen. `.` und `/` bewusst **nicht**, sonst wird `src/app/foo.ts` ein einziges Token und die Suche nach `foo` scheitert.
- Pfad- und Identifier-Suche (`handleFooBar`, `src/app/foo`) deckt stattdessen der **Trigram-Index** per Infix-Matching ab — genau der Fall, den `unicode61` prinzipiell nicht lösen kann. Er ist mit ~45–60 MB der teuerste Posten der DB; für einen Entwickler-Suchindex ist das den Platz wert. Bei Tier 3 wird er abgeschaltet.

Geschätzte DB-Größe in der Default-Konfiguration: **130–170 MB** gegen 510 MB Transcripts.

Query-Pfad: `MATCH` zuerst mit `LIMIT 200`, dann Join für Facetten, `bm25()` zur Sortierung, `snippet()` für Highlights, plus Score-Bonus für `is_user_prompt = 1` — das sind die Treffer, die ein Mensch sucht.

### Inkrementelles Parsen

**Cursor-Zustandsautomat** (`ingest/file-cursor.ts`), reine Funktion:

```ts
type CursorDecision = { kind: 'skip' } | { kind: 'append'; from: number }
                    | { kind: 'reindex' } | { kind: 'vanished' };
```
1. Größe + mtime + inode unverändert → **skip** ohne Lese-I/O (der Normalfall für 580 von 585 Dateien je Sweep).
2. Gewachsen, inode gleich → **append** ab `byte_offset`.
3. Geschrumpft oder inode geändert → `head_sha256` prüfen; gleich und gewachsen → trotzdem append (Replace-by-Rename mit identischem Präfix), sonst **reindex**.
4. `ENOENT` → **vanished**.

**Streaming-Reader** (`parsing/jsonl-line-reader.ts`): `createReadStream(path, { start: offset })`, **Splitting auf Buffer-Ebene an `0x0A`**, nicht auf String-Ebene — sonst stimmen die Byte-Offsets bei Umlauten und Emoji nicht mehr, und `byte_offset` ist die Grundlage für „Originalzeile anzeigen". Der Offset zeigt immer auf das Byte nach einem `\n`; eine unvollständige letzte Zeile wird schlicht nicht konsumiert und beim nächsten Durchlauf erneut gelesen — damit ist „Claude schreibt gerade mitten in die Zeile" ohne Sonderfall korrekt. Hard Cap 16 MiB pro Zeile (gemessenes Maximum 1,33 MB) gegen OOM bei korrupten Dateien. Ein JSON-Fehler in einer Zeile bricht nie die Datei ab.

**Batching:** 2.000 Zeilen oder 8 MiB je Transaktion, **Cursor-Update im selben Commit** wie die Datenzeilen → nach `kill -9` exakt wiederaufnehmbar. Danach `setImmediate`, damit RPC-Requests drankommen (Latenz während Import ~50–100 ms).

**Dreiphasiger Initial-Import** — Phase 1 ist der größte UX-Hebel und kostet fast nichts:

| Phase | Inhalt | Ziel | Nutzer sieht |
|---|---|---|---|
| 0 | `~/.claude.json` + `sessions/*.json` + `history.jsonl` | < 500 ms | Projektliste, Live-Sessions, letzte Prompts |
| 1 | pro Transcript nur **Head 32 KiB + Tail 256 KiB** → sessionId, cwd, Version, `started_at`, letztes `ai-title`, `last-prompt`, `cost-state`, `ended_at`; `index_state='skeleton'` | < 5 s für alle 359 | vollständige, sortierte Session-Liste mit Titeln — **bevor eine einzige Message existiert** |
| 2 | voller Message-Ingest, **sortiert nach `ended_at DESC`** | < 60 s | Fortschrittsbalken; Sessions einzeln als durchsuchbar markiert |

Watcher-Events haben Vorrang vor Phase 2 — eine laufende Session wird live nachgezogen, während der Backfill vom Juni wartet.

**Datei verschwindet:** nie `DELETE`. `file_present = 0`, `archived_at = now`, Cursor bleibt für Wiederauftauchen bestehen. Die App ist damit das Archiv, das Claude Codes Housekeeping überlebt.

### Watching

```ts
// indexer/watch/watch-roots.ts
~/.claude/projects   recursive  debounce 250ms  maxWait 1000ms
~/.claude/sessions   flach      debounce 150ms  maxWait  500ms
~/.claude/jobs       recursive  debounce 500ms  maxWait 2000ms
~/.claude/plans      flach      debounce 500ms  maxWait 2000ms
~                    flach      debounce 2000ms filter: name === '.claude.json'
```

**Niemals rekursiv auf `~/.claude`** — darunter liegen 1,6 GB in `skills/`, `plugins/`, `security/` und ein `backups/`, das minütlich wächst. Mit engen Wurzeln entstehen diese Events gar nicht erst, statt sie wegzufiltern.

`fs.watch(dir, { recursive: true })` hinter dem `WatcherPort` — auf macOS ein FSEvents-Handle für den ganzen Teilbaum statt 600 Einzel-Watches. chokidar 4 nutzt intern dasselbe und brächte nur Glob-Filter; der Port erlaubt den Wechsel in einer Datei, falls nötig.

**Dem Watcher wird nie vertraut.** `reconcile-sweep.ts` läuft alle 60 s (und bei Fensterfokus und `powerMonitor`-Resume): `readdir` + `stat` über alle Transcripts, Abgleich gegen `ingest_cursor`, Differenz einreihen. 600 `stat`-Aufrufe ≈ 10 ms. Damit ist ein verlorenes FSEvent ein **Latenz**-Problem (max. 60 s), kein Korrektheitsproblem.

Debounce **mit Max-Wait**: ein reiner Trailing-Debounce verhungert bei einer Datei, in die kontinuierlich geschrieben wird — also exakt bei der Session, die der Nutzer gerade beobachtet.

`~/.claude.json` zusätzlich **hash-gated** auf den `.projects`-Teilbaum: Die Datei ändert sich minütlich, dieser Teil praktisch nie. Eliminiert ~95 % der Arbeit an der am häufigsten mutierenden Datei.

### Live-Status und „wartet auf dich"

```ts
interface ProcessProbePort {
  probe(pids: readonly number[]): Promise<ReadonlyMap<number, string>>;  // EIN ps-Spawn für alle
}
```
Der Adapter setzt **zwingend** `env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' }`, abgesichert durch einen Negativtest mit der lokalisierten Ausgabe. Vergleich `procStart === psLstart` → `alive`, sonst `dead` (PID recycelt oder beendet).

Takt: `sessions/`-Watcher sofort; `ps`-Batch 5 s fokussiert / 30 s unfokussiert / pausiert wenn verborgen; `claude agents --json --all` 15 s / 60 s / pausiert — die CLI startet komplett, das kostet hunderte ms, und wird zusätzlich übersprungen, wenn sich weder `sessions/` noch `jobs/` noch die PID-Menge geändert haben. Jeder Fehler → Quelle gilt als nicht verfügbar, die App degradiert auf `sessions/` + `jobs/`.

`attention-rules.ts`, reine Funktion, nach Priorität:

| Level | Bedingung |
|---|---|
| `needs-you` | `alive` und (`status === 'waiting'` oder `waitingFor` gesetzt) |
| `needs-you` | `alive`, `status === 'busy'`, aber `statusUpdatedAt` **und** Transcript-mtime älter als 10 min |
| `needs-you` | Background-Agent mit `state === 'failed'` |
| `working` | `alive`, `busy`, Transcript-mtime jünger als 2 min |
| `idle` | `alive`, `idle` |
| `stale` | `dead`, aber `sessions/*.json` existiert noch |

Regel 2 ist der Kern: „behauptet beschäftigt zu sein, aber seit 10 Minuten passiert nichts" = Permission-Prompt oder abgestürzter Turn. **Der Transcript-mtime ist der fehlende Heartbeat** und liegt dank `ingest_cursor` ohnehin vor. Schlüssel der Merge-Map ist `sessionId`, nicht `pid` — PIDs werden recycelt, sessionIds nicht.

**Anzeige:** Tab-Badge aus `live-status.store`; `app.setBadgeCount(waitingCount)`; `dock.bounce('informational')` einmal je Übergang. System-Notification nur auf **Flankenwechsel** `idle|busy → waiting`, unterdrückt wenn Fenster fokussiert *und* dieser Pane aktiv, und erst wenn `waiting` ≥ 1,5 s stabil ist (die Statusdatei flattert). Klick fokussiert Fenster und aktiviert den Pane. Da die App benachrichtigt, wird `inputNeededNotifEnabled` in `~/.claude/settings.json` auf `false` gesetzt — das steht als Hinweis im Setup-Screen, die App ändert fremde Settings nicht selbst.

### Baum-Rekonstruktion

- Kanten aus `message.parent_uuid`, Index `(session_id, parent_uuid)`, `seq` als stabile Fallback-Ordnung.
- **`on_main_path` wird materialisiert**: bei jeder Änderung von `leaf_uuid` einmal von der Spitze zur Wurzel laufen und flaggen. Danach ist „zeig mir das lineare Gespräch" eine indizierte Query statt eines rekursiven CTE pro Scroll-Event.
- `child_count` denormalisiert → Fork-Punkte ohne Zusatz-Query markierbar.
- **Subagents** = `session`-Zeile mit `kind='subagent'`, `parent_session_id`, `spawn_tool_use_id` → Join auf `tool_use.tool_use_id`. Das UI rendert sie inline unter genau dem `Task`-Aufruf, der sie gestartet hat.
- **Baumelnde Parents**: `session-linker.ts` schlägt nach Phase 2 jeden dateiexternen `parent_uuid` im globalen UUID-Index nach → `parent_session_id` + `continued_from_uuid`. Ergebnis: „diese Session ist die Fortsetzung von jener". Bei 130k Zeilen Millisekunden.

### Renderer

**Angular 22, standalone, Signals, neue Control-Flow-Syntax, `provideZonelessChangeDetection()`.**

Zoneless ist hier keine Stilfrage: Mit Zone.js löst jeder PTY-Chunk und jedes `keydown` im Terminal einen App-weiten Change-Detection-Lauf aus. Bei ~125 IPC-Nachrichten/s gegen Sidebar + Liste + Transcript ist das der Performance-Killer. Zoneless + Signals heißt: xterm rendert in seinem WebGL-Canvas, Angular merkt davon nichts.

**State: Signals + Services, kein NgRx.** Die Source of Truth liegt im Indexer und im `PtyManager`; der Renderer ist eine *Projektion*. NgRx' Wert (Time-Travel, Action-Replay, entkoppelte Effects) würde hier eine zweite Wahrheit neben dem Main-Prozess etablieren und permanent synchron gehalten werden müssen — genau die Grenze, die der Entwurf scharf halten will.

```
core/ipc/{api.token.ts, ipc-client.ts, event-bus.ts}     api.token = der Test-Seam
core/state/{projects,sessions,live-status,terminal,search,runtime}.store.ts
core/commands/{command.ts, command-registry.ts}          Basis für ⌘K später
layout/{shell,sidebar,statusbar}/
features/setup/            blockierend, wenn `claude` nicht auflösbar
features/dashboard/        live-session-card, recent-activity
features/archive/          session-table, session-filter-bar
features/search/
features/session-detail/   transcript-view + renderers/{text,tool-use,tool-result,meta}-block
                           virtual/{measured-size-strategy,item-size-cache}.ts
features/terminal/         terminal-dock, terminal-tab-bar, pane-host (REKURSIV),
                           terminal-pane, launch-dialog, pane-exit-overlay
```

Routing: `/` Dashboard, `/projects/:id`, `/sessions/:id`, `/archive`, `/search`, alles `loadComponent`. **Das Terminal-Dock liegt außerhalb des `router-outlet`** im Shell-Grid — `terminal-pane` darf nie zerstört werden, sonst ist der xterm-Buffer weg. Auf-/zuklappbar per CSS, niemals per `@if`.

**Transcript-Performance**, zwei Ebenen:
1. **Fensterung über RPC** — `getMainPath(id, page)` mit Sparse-Map und Prefetch ±200 Items. Bei 83 MB scheitert „alles laden" schon am Payload.
2. **Eigene `VirtualScrollStrategy`** (~150 Zeilen) über einem `ItemSizeCache` mit `ResizeObserver`. CDK-`FixedSize` scheidet aus (Höhen variieren um Größenordnungen), `AutoSize` ebenfalls (seit Jahren experimentell, Scroll-Anchoring unbrauchbar bei Sprüngen).

Zusätzlich, weil es mehr bringt als jede Scroll-Optimierung: Tool-Results und große Textblöcke auf ~8 KB kappen mit „mehr anzeigen"; `thinking` gar nicht rendern (es ist leer).

Styling: Tailwind v4, keine Component-Library (die Oberfläche ist Listen, Tabellen, Tabs — Angular Material brächte Theming-Ballast ohne Gegenwert). CDK nur für `scrolling`, `overlay`, `a11y`.

### Terminal

**xterm.js + node-pty.** Addons: `fit`, `webgl` (mit Canvas-Fallback), `unicode11`, `web-links`, `search`, `serialize`. `allowProposedApi: true`, `scrollback: 10000`, **`macOptionIsMeta: true`** (sonst funktionieren Alt-Shortcuts in der Claude-TUI nicht).

WebGL-Kontexte sind im Browser auf ~16 limitiert — `onContextLoss` → dispose + Canvas-Fallback ist von Anfang an drin, sonst ist es später ein unreproduzierbarer Bug bei Splits.

`fit()` guarded: `if (!el.isConnected || el.clientWidth === 0) return;` — `fit()` auf einem unsichtbaren Element berechnet 0 Spalten und zerstört das Layout des Kindprozesses.

**Env-Auflösung** (`runtime/shell-env-resolver.ts`), einmal beim Start, gecacht:
1. `$SHELL -l -i -c '...; /usr/bin/env -0'` in einem kurzlebigen PTY (nicht `exec` — zsh verhält sich ohne TTY anders), Timeout 5 s.
2. **fnm-Korrektur**: alle `…/fnm_multishells/<pid>_<ts>/bin`-Einträge aus `PATH` entfernen. Diese Verzeichnisse sind an die Probe-Shell gebunden und werden aufgeräumt — gecacht sind sie eine tickende Bombe („node: command not found", aber erst nach Stunden). Stattdessen einmal `fnm exec --using=default -- node -e "process.execPath"` auflösen und dessen `dirname` voranstellen.
3. **Electron-Gift entfernen**: `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, `ELECTRON_*` löschen, sonst startet jeder `node`-Subprozess im Electron-Modus.
4. Setzen: `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=CodeStation`. `LANG`/`LC_*` aus der Probe übernehmen, sonst brechen die Unicode-Boxzeichen der Claude-TUI.
5. `/opt/homebrew/bin` kommt aus `/etc/paths.d/homebrew` — **GUI-gestartete Apps bekommen das von launchd nicht.** Die Login-Shell-Probe ist Pflicht, nicht optional.

**Claude-Panes starten keine Shell**, sondern direkt `pty.spawn(claudeBin, argv, { cwd, env })`. Drei Gründe: `pty.pid` ist dann exakt die PID in `sessions/<pid>.json` (die Korrelation wird exakt statt heuristisch), keine rc-Banner im Terminal, und `kill(pid)` trifft den richtigen Prozess. `claude` ist ein Mach-O-Binary, kein Node-Script — es gibt keinen Wrapper-Prozess.

**`argv-builder.ts`** ist eine reine Funktion `(LaunchSpec, CliCapabilities) => string[]` — zugleich der beste TDD-Kandidat und die Sicherheitsgrenze:
```
new        → ['--session-id', uuid, '-n', name]
resume     → ['--resume', id]
fork       → ['--resume', id, '--fork-session']     // neue ID unbekannt → state 'binding'
background → [...base, '--bg']                      // spawn + stdout parsen, dann attach
attach     → ['attach', shortId]
```
`spawn` nie mit `shell: true`. `-n <name>` ist der einzige frei vom Nutzer stammende Wert — als eigenes argv-Element, auf Länge und Control-Chars normalisiert. **`claude project purge` ist nirgends über IPC erreichbar** — kein Handler, keine Konstante. Im freien Shell-Pane kann der Nutzer es tippen; das ist seine Entscheidung, nicht die der App.

**PTY-Output**: Kanal `fd:pty:${paneId}`, `webContents.send`. **String statt Uint8Array** — node-pty dekodiert UTF-8 inklusive über Chunk-Grenzen gesplitteter Multibyte-Sequenzen bereits korrekt; das nachzubauen hieße, Codepoints zu riskieren. Der Flaschenhals ist nicht die Serialisierung, sondern die **Nachrichtenanzahl**: `output-coalescer.ts` puffert pro Pane und flusht bei ≥ 8 KiB oder nach 8 ms → bei `npm install`-Flut ~125 statt ~5.000 Nachrichten/s.

**Backpressure ist credit-basiert und nicht nachrüstbar** (`flow-control.ts`): High-Water 2 MiB → `pty.pause()`, Low-Water 512 KiB → `pty.resume()`. Renderer bestätigt mit `term.write(chunk, () => api.pty.ack(paneId, chunk.length))` — xterm ruft den Callback erst, wenn der Chunk geparst ist, das ist das einzige ehrliche Signal. Ohne diesen Loop blockiert ein `npm install` in einem *unsichtbaren* Tab den Renderer-Mainthread. Deshalb `handleFlowControl: false`: die Flusskontrolle sitzt oberhalb von node-pty auf echten Render-Acks.

Main hält zusätzlich je Pane einen **1-MiB-Ringpuffer** des Rohoutputs, damit inaktive Tabs nicht gerendert werden müssen, der Kindprozess aber nicht blockiert. Beim Tab-Wechsel holt der Renderer ihn am Stück.

**Alternate Screen Buffer:** Da `tui: "fullscreen"` gesetzt ist, schreibt Claude keinen Scrollback — `SerializeAddon` liefert für Claude-Panes nur den aktuellen Bildschirm. Scrollback-Persistenz für diese Panes ist daher kein Feature, sondern ein Missverständnis: Die Historie *ist* das Transcript, und das hat der Indexer. `persistBuffer: false` für `kind: 'claude'`, das Addon bleibt für spätere Shell-Panes geladen. Nebeneffekt: Mausreporting ist aktiv, Selektion geht nur mit gedrückter Alt-Taste — das gehört in einen Tooltip, nicht „gefixt".

**App-Neustart tötet laufende PTYs** — das ist unvermeidbar, der Master-FD gehört Electron. Drei Maßnahmen statt Kaschierung:
1. `before-quit`-Dialog, der auflistet, was beendet wird.
2. Nach dem Neustart erscheinen die Panes als `detached` mit „Resume" — die sessionId ist dank `--session-id` immer bekannt. Das ist der eigentliche Gewinn dieses Flags.
3. `--bg`-Toggle im Launch-Dialog für Sessions, die weiterlaufen sollen; die App hängt sich per `attach <shortId>` dran.

#### Terminal-Abstraktion (der Schnitt gegen die Sackgasse)

Drei getrennte Konzepte ab Tag 1, auch wenn v1 nur eine Ausprägung zeigt:

```ts
export type PaneSpec =
  | { kind: 'claude'; projectPath: string; launch: ClaudeLaunchSpec; persistBuffer: false }
  | { kind: 'shell';  projectPath: string; profileId: ProfileId;     persistBuffer: boolean };

export type LayoutNode =
  | { type: 'leaf';  paneId: PaneId }
  | { type: 'split'; direction: 'row' | 'column'; children: LayoutNode[]; sizes: number[] };

export interface TerminalTab { id: TabId; title: string; root: LayoutNode; activePaneId: PaneId }
export interface PersistedWorkspace { version: 1; tabs: TerminalTab[]; activeTabId: TabId | null }
```

v1-Einschränkung, nicht v1-Typsystem: jeder `tab.root` ist ein `leaf`, nur `kind: 'claude'` wird erzeugt, der `split`-Zweig in `pane-host.ts` ist implementiert aber unerreichbar.

Vier Entscheidungen, die den Ausbau ohne Rewrite tragen:
- **`PtyManager` ist `Map<PaneId, PtyHandle>` — niemals `Map<TabId, …>`.** Das ist die wichtigste Zeile im Projekt; jede tab-zentrierte Abkürzung erzwingt später ein gleichzeitiges Rewrite von Main, IPC und Renderer.
- `pane-host.ts` ist rekursiv über `LayoutNode`, auch wenn die Rekursion nie tiefer als 1 geht.
- IPC ist pane-adressiert, nie tab-adressiert.
- Der Spawn-Pfad geht immer durch `profile-resolver.ts` — „Claude" ist nur ein eingebautes Profil mit dynamischer argv.

`workspace.json` in `userData`, versioniert, atomar (tmp + rename). Format ist schon der Zielzustand, also keine Migration beim Ausbau.

#### Korrelation Pane ↔ Session

```
paneId ──spawn──▶ pid ──▶ ~/.claude/sessions/<pid>.json ──▶ sessionId ──▶ Transcript (Indexer)
```
Robustheitsregeln: `.json` nur akzeptieren wenn `startedAt >= pane.spawnedAt - 2000` (PID-Recycling); `process.kill(pid, 0)` zur Liveness-Prüfung, bei `ESRCH` als stale markieren statt löschen (die Datei gehört der CLI); bei `--fork-session` geht der Pane in `state: 'binding'` mit 10-s-Timeout statt Endlos-Spinner; zwischen `pane.bound` und `session.appeared` können Sekunden liegen — die UI zeigt in der Lücke die Pane-eigenen Daten, nie „Session nicht gefunden".

Extern gestartete Sessions durchlaufen dieselbe Pipeline ohne `paneId`, Label „extern". `attach` ist für `kind: 'interactive'` nicht möglich → Aktion ist „In neuem Pane fortsetzen" (`--resume`), mit Warnung falls der Prozess noch läuft. Zwei Prozesse auf einem Transcript ist eine schlechte Idee — die App warnt, verbietet aber nicht.

### Security

`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webviewTag: false`. Sandbox funktioniert, weil das Preload nur `ipcRenderer` und den `MessagePort` nutzt — node-pty und SQLite leben ausschließlich außerhalb des Renderers. Das ist Designziel, nicht Zufall.

Custom `app://`-Protokoll statt `file://` (echter Origin, dadurch ist `default-src 'self'` sinnvoll). CSP via `onHeadersReceived`, damit Dev und Prod denselben Pfad nehmen. `setWindowOpenHandler` → deny, `will-navigate` auf eigenen Origin beschränkt; externe Links nur über einen IPC-Handler mit `http(s)`-Allowlist — relevant, weil das weblinks-Addon URLs aus Claude-Output klickbar macht.

Die eigentliche Sicherheitsgrenze ist der IPC-Vertrag: kein generischer „führe Kommando aus"-Kanal, `projectPath` kommt aus dem Index oder aus `dialog.showOpenDialog`, nie aus einem Freitextfeld, und wird im Main gegen `realpath` + `stat` validiert.

**Datenschutz**: `~/.claude.json` enthält `userID`, `machineID`, Auth-Caches. Der Port exponiert nur `readClaudeProjects(): ProjectRegistryEntry[]` — eine verengte Rückgabe, sodass der restliche Code die anderen Felder gar nicht sehen *kann*. `sessions/*.key` wird nie geöffnet. Index-DB 0600. Keine Telemetrie.

`app.requestSingleInstanceLock()` ist hier nicht kosmetisch: zwei Instanzen würden den Index doppelt schreiben, doppelt benachrichtigen und sich beim `workspace.json` überschreiben.

---

## Meilensteine

Jeder endet mit etwas Startbarem.

| M | Inhalt | Fertig, wenn |
|---|---|---|
| **M0** | Node 24 via fnm + `.node-version`; Workspaces, `tsconfig.base.json`, esbuild-Configs, `scripts/dev.mjs`; Fenster mit vollständiger Security-Baseline + `app://`; leere Angular-App; Spec nach `docs/specs/` committen | `npm run dev` öffnet ein Fenster mit Angular |
| **M1** | `shared/contracts/*` + `shared/domain/*`; RPC-Client, Event-Bus, `api.token`; Shell-Grid, Sidebar, Routing — gegen Fake-Daten im Main | Klickbare Oberfläche, Typvertrag steht |
| **M2** | DB-Fundament: `connection`, `migrator`, `0001_init.sql`, Repositories | Repository-Tests gegen `:memory:` grün |
| **M3** | Parsing: `jsonl-line-reader`, `record-decoder` + alle Record-Decoder, `content-blocks`, `tool-input-summary` | Alle 28 Typ-Fixtures dekodieren; Byte-Offset-Tests grün |
| **M4** | Ingest-Kern: `file-cursor`, `transcript-ingestor`, `ingest-scheduler` | Fixture-Transcripts → korrekte DB-Zeilen; append/truncate/rewrite/delete getestet |
| **M5** | **Erste vertikale Scheibe**: `utilityProcess` + Port-Brokering + Preload-RPC + `claude-json-ingestor` | Renderer zeigt die 37 echten Projekte. Ab hier laufen B und C parallel |
| **M6** | Phasen-Import: `skeleton-ingestor`, `history-ingestor`, `event-publisher` | Session-Liste < 5 s, Vollimport < 60 s, abbrechbar und wiederaufnehmbar |
| **M7** | FTS: `0002_fts.sql`, `text-extraction`, `search-repository`; Such-UI | Tier 1+2 durchsuchbar; Umlaut- und Code-Tests grün; DB-Größe gemessen |
| **M8** | Watching: `watch-roots`, `coalescing-queue`, `change-router`, `reconcile-sweep` | Live-Session aktualisiert ~1×/s; `.claude.json`-Minutentakt erzeugt keine Arbeit |
| **M9** | Live-Status: `ps-process-probe`, `exec-claude-cli`, `stale-detector`, `attention-rules`; Dashboard + Dock-Badge | „Wartet auf dich" korrekt inkl. verwaister PID 11554 und `failed` Background-Agent |
| **M10** | Transcript-Ansicht: Fensterung, eigene Virtual-Scroll-Strategy, Message-Renderer | Die 83-MB-Session öffnet und scrollt bis ans Ende |
| **M11** | Baum, Subagents, Pläne, File-Touches: `tree-builder`, `main-path`, `subagent-ingestor`, `plans-ingestor`, `session-linker` | Fork- und Resume-Fixtures korrekt; Plan↔Session-Links mit confidence 1.0 |
| **M12** | Kosten: `0003_pricing.sql`, `cost-repository`, Anzeige je Session/Projekt | Berechnete Kosten innerhalb 1 % der 31 echten `cost-state`-Werte |
| **M13** | **Terminal v1**: `shell-env-resolver`, `claude-binary-resolver`, `argv-builder`, `pty-port`/`node-pty-adapter`, `pty-manager`, `output-coalescer`, `flow-control`, `workspace-store`; Dock, `pane-host`, `terminal-pane`, `launch-dialog` | Claude-Sessions starten und fortsetzen aus der App |
| **M14** | Korrelation + Notifications: `session-correlator`, `pane.bound`, Tab-Badges, Notification Center, Querverlinkung Pane ↔ Session-Detail | Badge erscheint am richtigen Tab; Klick auf Notification springt dorthin |
| **M15** | Härtung + Packaging: Fehlerzustände, Single-Instance, Quit-Dialog, `--bg`-Pfad, Projekt-Kuratierung, `electron-builder.yml` mit Info.plist-Strings und Dev-Identity-Signing | Eine installierte `.app`, die täglich benutzt wird |

M5 ist bewusst früh: ab da existiert eine echte, getypte API gegen echte Daten.

---

## Tests

**Grundsatz:** Alles Unreine ist ein Port — `fs`, `ps`, die CLI, die Uhr, der Watcher. Tests injizieren Fakes, kein `vi.mock('fs')`. **SQLite wird nicht gefaked** — `:memory:` + derselbe Migrator; das SQL ist das, was am ehesten falsch ist.

**Fixtures, zusammen < 2 MB:**
1. `test/fixtures/records/*.json` — eine Datei je gefundenem `type` (28 Stück), wörtlich aus echten Daten, über `scripts/scrub-fixture.ts` anonymisiert (UUIDs, `/Users/<name>`, `ownerAccountUuid`, `machineID`, `userID`, Prompt-Inhalte).
2. `test/fixtures/transcripts/*.jsonl` — 10 Mini-Transcripts, je ein Szenario: Happy Path, Fork, baumelnder Root, Subagent + `.meta.json`, `relocated`/Worktree, ausgelagertes Tool-Result, abgeschnittene letzte Zeile, unbekannter Typ, 2-MB-Zeile, Multibyte direkt vor `\n`.
3. `test/support/transcript-factory.ts` — Builder für synthetische Last. Nichts Großes wird eingecheckt.

**TDD** (lohnt sich, weil rein und hochriskant): `record-decoder` → `jsonl-line-reader` (Byte-Offsets) → `file-cursor` (Zustandsautomat tabellengetrieben) → Repositories → `transcript-ingestor` → `tree-builder`/`main-path` → `stale-detector` + `attention-rules` (**inklusive Negativtest mit lokalisierter `ps`-Ausgabe**) → `argv-builder` → `output-coalescer` + `flow-control` (mit Fake-Clock).
Kein TDD bei: IPC-Verdrahtung, Window-Erzeugung, electron-builder-Config.

**Renderer**: Vitest + TestBed mit `provideZonelessChangeDetection()`, Test-Seam ist `CS_API` (InjectionToken) mit einer `FakeApi` samt steuerbarem Event-Stream. Getestet werden Stores, `item-size-cache`, `measured-size-strategy`, Fensterlogik und Pipes. Keine Template-Snapshots.

**PTY deterministisch testen**: nicht das PTY faken, sondern **das Binary austauschen**. `test/fixtures/fake-claude.mjs` spiegelt argv nach stdout, schreibt eine `sessions/<pid>.json` in ein temporäres `HOME`, flutet auf Wunsch Output und endet mit definiertem Code. Der `claudeBinaryPath` ist ohnehin konfigurierbar — kostet also nichts und braucht keine Mocks im Produktivpfad.

**E2E**: Playwright `_electron.launch()`, ~6 Flows. Löst zugleich das ABI-Problem — Native-Module-Tests laufen via `electronApp.evaluate()` direkt gegen den `PtyManager` im Main.

**Golden Master, opt-in, nie in CI**: `INDEXER_REAL_DATA=1 npm run test:real` indiziert das echte `~/.claude` read-only in eine Wegwerf-DB und prüft **Invarianten statt Werte** — jede Session hat ≥1 Message oder `index_state='skeleton'`; kein `unknown_record`-Typ ohne registrierten Decoder (bricht absichtlich, sobald Claude Code etwas Neues schreibt); berechnete Kosten innerhalb 1 % der echten `cost-state`; Byte-Offsets einer Stichprobe liefern beim Seeken wieder gültiges JSON mit derselben `uuid`.

---

## Verifikation

Nach M9 (read-only Teil vollständig):
```bash
npm run dev
```
1. **Index**: Projektliste erscheint < 1 s, Session-Liste mit Titeln < 5 s, Fortschrittsbalken läuft durch, Statusbar zeigt „Index vollständig". Gegenprobe: App beenden während Phase 2, neu starten → Import setzt fort statt neu zu beginnen.
2. **Live-Status**: In iTerm `claude` in einem Projekt starten → erscheint binnen ~1 s im Dashboard. Eine Frage stellen, die eine Permission-Abfrage auslöst → Status springt auf „wartet auf dich", Dock-Badge erscheint, Notification kommt. Antworten → Badge verschwindet.
3. **Stale**: `~/.claude/sessions/` enthält Einträge toter Prozesse — die müssen als `stale` erscheinen, nicht als laufend. PID 11554 (läuft seit 3. Sep, Status vom 23. Sep) ist der konkrete Testfall für den mtime-Heartbeat.
4. **Suche**: Nach einem deutschen Wort mit Umlaut suchen (`Prüfung`), nach einem Code-Identifier (`handleFooBar`), nach einem Pfadfragment (`src/app/`). Alle drei müssen treffen. Negativprobe: ein String, der nur in einem Tool-Result vorkommt, darf **nicht** treffen (Tier 3 ist aus).
5. **Großes Transcript**: Die 83-MB-Session öffnen, ans Ende springen, zurückscrollen. Kein Freeze, Speicher bleibt stabil.

Nach M13/M14 (Terminal):
6. Neuen Tab öffnen → `claude` startet im richtigen cwd, TUI rendert korrekt (Boxzeichen, Farben, Alt-Shortcuts). `node -v` und `composer -V` in einem Shell-Pane funktionieren — belegt, dass die Env-Auflösung inklusive fnm-Korrektur greift.
7. In dem Tab eine Permission-Abfrage auslösen → Badge am Tab, Notification, Klick springt zum Tab.
8. `npm install` in einem **inaktiven** Tab laufen lassen, parallel im Dashboard scrollen → kein Ruckeln. Das ist der Backpressure-Test.
9. App beenden mit laufender Session → Dialog listet sie auf. Nach Neustart: Pane als „beendet" mit Resume; Resume stellt dieselbe Session wieder her.
10. Session mit `--bg`-Toggle starten, App beenden, neu starten → Session läuft noch, „Wieder anhängen" funktioniert.

Automatisiert:
```bash
npm test            # Vitest: indexer + main + renderer
npm run test:e2e    # Playwright gegen fake-claude
npm run lint        # inkl. Import-Boundary-Regel
npm run typecheck
INDEXER_REAL_DATA=1 npm run test:real   # lokal, gegen echte Daten
```

---

## Risiken

| # | Risiko | Gegenmaßnahme |
|---|---|---|
| R1 | **Schema-Drift bei Claude-Updates — bereits eingetreten.** Sechs Record-Typen und drei Felder existieren, die ein sorgfältiger erster Scan derselben Installation nicht fand | Decoder-**Registry**, unbekannter Typ → `unknown_record`, nie `throw`. Decoder lesen nur was sie brauchen, kein `.strict()`. `byte_offset` macht die Rohzeile jederzeit rekonstruierbar — ein später wichtiges Feld lässt sich nachziehen, ohne es je gespeichert zu haben. `session.cc_version` korreliert „Parsing kaputt" mit „Version gewechselt". Diagnose-View zeigt unbekannte Typen und Fehlerrate |
| R2 | `claude agents --json --all` ist undokumentierte CLI-Oberfläche | In `exec-claude-cli.ts` gekapselt, 5 s Timeout, `stdin: 'ignore'`. Fehler → „Quelle nicht verfügbar", App degradiert auf `sessions/` + `jobs/` |
| R3 | `better-sqlite3`/`node-pty` ABI an Electron gebunden | Electron exakt pinnen, `install-app-deps` als postinstall, Smoketest beim Start mit klarem Dialog statt weißem Fenster. **Die DB ist bewusst wegwerfbar** — Neuaufbau ~60 s; nur Nutzerdaten (Tags, Notizen, Pins) liegen in eigenen, vom Nuke ausgenommenen Tabellen |
| R4 | TCC: 12 Projekte unter `~/Documents`/`~/Desktop`/`~/Downloads`, **der PTY-Kindprozess erbt die Entscheidungen der App** | `NS*FolderUsageDescription` in Info.plist (ohne sie: stilles `EPERM` statt Prompt), stabile Signing-Identity, `EPERM`-Erkennung mit Deep-Link in die Systemeinstellungen statt „Unbekannter Fehler" |
| R5 | Performance-Fallen | Nie Inserts ohne Transaktion (~100× langsamer); `toolUseResult` und `tool_result`-Block nicht beide speichern (142 MB Duplikat); `thinking`-Signaturen nie (38,7 MB ohne Suchwert); Attachment-Bodies nur das Kontextbudget; Tier 3 opt-in; Watcher-Wurzeln eng; nie eine ganze Session in einem Payload. **Der Cursor ist das, was verhindert, dass die 83-MB-Datei bei jedem Tick komplett gelesen wird — die wichtigste zu testende Invariante** |
| R6 | Eigene Schema-Migrationen | `PRAGMA user_version`, nummerierte Vorwärts-SQL in einer Transaktion. Jede Migration klassifiziert als `derived` (Wipe + Reindex, der Default) oder `preserving`. Weil Reindex nur ~60 s dauert, sind 95 % künftiger Änderungen trivial. DB von neuerer App-Version → Öffnen verweigern statt korrumpieren |
| R7 | Terminal-Ausbau erzwingt Rewrite | `Map<PaneId, …>` statt `Map<TabId, …>`, rekursives `pane-host`, pane-adressiertes IPC, `profile-resolver` auch für Claude. `workspace.json` ist von Anfang an im Zielformat |

---

## Hinweis zum Vorgehen

Dieser Plan ist zugleich der Spec. In M0 wird er als `docs/specs/2026-10-08-codestation-design.md` ins Repo committet, damit er versioniert neben dem Code lebt. Teilprojekte D (Offene Fragen) und E (Terminal-Ausbau) bekommen je einen eigenen Plan, sobald A–C stehen.
