# Installation

CodeStation läuft auf **macOS 13 (Ventura) oder neuer** auf **Apple Silicon**
(M1 und neuer). Eine Intel-Ausgabe gibt es nicht.

Vorausgesetzt wird eine installierte
[Claude-Code-CLI](https://claude.com/claude-code). CodeStation findet sie
selbst; falls nicht, lässt sich der Pfad im Einrichtungsbildschirm setzen.

---

## 1. Herunterladen

Alle Ausgaben liegen unter
[**Releases**](https://github.com/Coho04/codestation/releases).

| Datei | Wofür |
|---|---|
| `CodeStation-<version>-arm64.dmg` | Das, was du willst. Disk-Image zum Installieren. |
| `CodeStation-<version>-arm64-mac.zip` | Nur für die Selbstaktualisierung. Von Hand nicht nötig. |
| `latest-mac.yml` | Die Datei, in der die App nach neuen Versionen sucht. |

Lade das `.dmg`, öffne es und ziehe **CodeStation** in den Ordner
**Programme**. Danach kann das Image ausgeworfen werden.

> Installiere in `/Applications`, nicht in `~/Downloads`. Die
> Selbstaktualisierung ersetzt das Bundle an Ort und Stelle, und ein Bundle mit
> Quarantäne-Markierung im Download-Ordner macht dabei Ärger.

## 2. Nicht signierte Ausgabe öffnen

Wenn im Release steht, die Ausgabe sei nicht notarisiert, meldet macOS beim
ersten Start:

> „CodeStation" kann nicht geöffnet werden, da Apple es nicht auf schädliche
> Software überprüfen konnte.

Das heißt nicht, dass etwas gefunden wurde — es heißt, dass nicht gesucht wurde.
Zum Öffnen:

1. **Rechtsklick** auf CodeStation im Programme-Ordner → **Öffnen**
2. Im Dialog noch einmal **Öffnen**

Das ist einmalig. Führt der Weg nicht zum Ziel (macOS 15 und neuer sind
strenger), hilft:

**Systemeinstellungen → Datenschutz & Sicherheit** — dort steht unten ein
Hinweis zu CodeStation mit dem Knopf **Dennoch öffnen**.

Alternativ auf der Kommandozeile:

```bash
xattr -d com.apple.quarantine /Applications/CodeStation.app
```

Das entfernt die Quarantäne-Markierung, die der Browser beim Download gesetzt
hat. Tu das nur mit Software, deren Herkunft du kennst — hier also: wenn du das
Disk-Image aus diesem Repository geladen oder selbst gebaut hast.

## 3. Ordner-Freigaben

Beim ersten Start fragt macOS nach Zugriff auf **Dokumente**, **Schreibtisch**
oder **Downloads** — aber nur, wenn dort Projekte liegen.

Die Freigabe ist nicht optional und lässt sich nicht umgehen: ohne sie kann
weder das Transcript eines dort liegenden Projekts gelesen noch eine Session in
diesem Ordner gestartet werden. Die Kindprozesse im Terminal erben die
Entscheidung — eine verweigerte Freigabe bedeutet also auch, dass Claude dort
keine Dateien lesen kann.

Nachträglich änderbar unter **Systemeinstellungen → Datenschutz & Sicherheit →
Dateien und Ordner**.

> Die Freigaben hängen an der Kombination aus App-Kennung und Signatur. Ersetzt
> du eine lokal gebaute Ausgabe durch eine aus einem Release, fragt macOS
> erneut.

---

## Aktualisieren

Die Statusleiste unten rechts zeigt die laufende Version; ein Klick darauf
öffnet die Update-Ansicht und prüft sofort. Automatisch wird alle sechs Stunden
geprüft, erstmals dreißig Sekunden nach dem Start. Abschaltbar ist das in
derselben Ansicht — ist es aus, geht keine Anfrage hinaus.

**Notarisierte Ausgabe:** „Herunterladen", dann „Neu starten und installieren".
Laufende Terminal-Sessions enden dabei; ihre Transcripts bleiben vollständig und
lassen sich danach fortsetzen.

**Jede andere Ausgabe:** Der Knopf öffnet die Release-Seite. Lade das neue
Disk-Image und ersetze CodeStation im Programme-Ordner. Einstellungen und Index
bleiben erhalten, sie liegen außerhalb des Bundles.

---

## Selbst bauen

Für den Eigenbedarf ist das der kürzeste Weg zu einer Ausgabe, die macOS ohne
Murren öffnet.

```bash
git clone https://github.com/Coho04/codestation.git
cd codestation
fnm use                 # Node 24, siehe .node-version
npm install             # baut node-pty und better-sqlite3 gegen die Electron-ABI
npm run package         # Ergebnis: release/mac-arm64/CodeStation.app
```

### Mit eigenem Zertifikat signieren

Ohne Signatur erzeugt jeder Build eine neue Prüfsumme, und macOS fragt nach
jedem Neubau wieder nach den Ordner-Freigaben. Ein gewöhnliches
**Apple-Development**-Zertifikat aus Xcode genügt, um das zu vermeiden:

```bash
security find-identity -v -p codesigning        # zeigt, was vorhanden ist
export CSC_NAME="Apple Development: Dein Name (TEAMID)"
npm run package
```

`CSC_NAME` liest electron-builder von sich aus; im Repository steht bewusst
keine Identität, weil sie auf jedem Rechner eine andere ist.

Für eine Ausgabe, die auch auf fremden Rechnern ohne Warnung startet **und**
sich selbst aktualisieren kann, braucht es ein **Developer-ID**-Zertifikat aus
dem kostenpflichtigen Apple Developer Program sowie Notarisierung. Die
[Release-Workflow-Datei](../.github/workflows/release.yml) erledigt beides, sobald
diese Secrets im Repository hinterlegt sind:

| Secret | Inhalt |
|---|---|
| `MACOS_CERTIFICATE` | Developer-ID-Zertifikat als `.p12`, base64-kodiert |
| `MACOS_CERTIFICATE_PASSWORD` | Passwort dieser `.p12`-Datei |
| `APPLE_ID` | Apple-ID des Entwicklerkontos |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-spezifisches Passwort für die Notarisierung |
| `APPLE_TEAM_ID` | Team-ID, zehn Zeichen |

Fehlt auch nur eines davon, baut der Workflow trotzdem — dann eben unsigniert,
mit einem entsprechenden Hinweis im Release.

---

## Eine Version veröffentlichen

```bash
# 1. Version anheben; der Tag muss exakt dazu passen, der Workflow prüft das.
npm version minor          # oder: patch, major

# 2. CHANGELOG.md ergänzen und mit in den Versions-Commit nehmen
git add CHANGELOG.md && git commit --amend --no-edit

# 3. Commit und Tag schieben — das löst den Release-Workflow aus
git push --follow-tags
```

`npm version` legt Commit und Tag `vX.Y.Z` an. Der Workflow baut, prüft, packt
und lädt Disk-Image, ZIP und `latest-mac.yml` in ein GitHub-Release. Die
`latest-mac.yml` ist das, worauf die Update-Prüfung der installierten Apps
schaut — ein Release ohne sie bleibt für alle unsichtbar.

---

## Wo liegen die Daten?

| Pfad | Inhalt |
|---|---|
| `~/Library/Application Support/CodeStation/index.db` | Der Index. Jederzeit löschbar, Neuaufbau ~15 s. |
| `~/Library/Application Support/CodeStation/settings.json` | Einstellungen. |
| `~/Library/Application Support/CodeStation/workspace.json` | Offene Terminal-Tabs. |

CodeStation sendet nichts an Dritte. Die einzige ausgehende Verbindung ist die
Update-Prüfung gegen `api.github.com`, und die lässt sich abschalten.

`~/.claude` wird gelesen, nicht geschrieben — mit einer Ausnahme: „Auf der
Platte löschen" entfernt Transcripts. Das passiert nur auf ausdrückliche
Anweisung, hinter einem Bestätigungsdialog, der Dateianzahl und Größe nennt.

## Deinstallieren

```bash
rm -rf /Applications/CodeStation.app
rm -rf ~/Library/Application\ Support/CodeStation
rm -rf ~/Library/Caches/de.mediacologne.codestation
rm -f  ~/Library/Preferences/de.mediacologne.codestation.plist
```

`~/.claude` bleibt dabei unberührt — Projekte, Sessions und Transcripts gehören
Claude Code, nicht CodeStation.

## Wenn etwas nicht geht

| Symptom | Ursache und Abhilfe |
|---|---|
| Fenster bleibt weiß | Native Module passen nicht zur Electron-Version. Im Quellbaum: `npm install` erneut ausführen (der `postinstall`-Hook baut sie neu). |
| „Claude nicht gefunden" in der Statusleiste | Die CLI liegt nicht im PATH der grafischen Oberfläche. Pfad im Einrichtungsbildschirm setzen. |
| Projekte unter Dokumente fehlen | Ordner-Freigabe verweigert. Siehe Abschnitt 3. |
| Index bleibt leer | `~/.claude/projects` existiert nicht — Claude Code wurde noch nie benutzt. |
| Update-Prüfung meldet einen Fehler | Keine Verbindung zu `api.github.com`, oder das Stundenlimit von 60 Anfragen pro IP ist erreicht. Beides erledigt sich von selbst. |
