# Changelog

Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionierung [Semantic Versioning](https://semver.org/lang/de/).

## [Unveröffentlicht]

## [0.1.0] — 2026-10-12

Erste Ausgabe.

### Hinzugefügt

- **Index** über `~/.claude`: Projekte, Sessions, Nachrichten, Tool-Aufrufe,
  Pläne und Datei-Änderungen in einer lokalen SQLite-Datenbank. Inkrementell
  über Byte-Offsets, dreiphasiger Erstimport (Projektliste < 1 s, Session-Liste
  < 5 s, Volltext danach).
- **Archiv statt Spiegel**: Transcripts, die Claude Code selbst weggeräumt hat,
  bleiben im Index erhalten.
- **Live-Status** jeder laufenden Session, unabhängig davon, wo sie gestartet
  wurde — inklusive Hintergrund-Agents. Dock-Badge und Benachrichtigung, wenn
  eine Session auf eine Antwort wartet.
- **Volltextsuche** mit Umlaut-Faltung und einem zweiten Trigram-Index für
  Pfade und Bezeichner.
- **Kosten** je Session, Modell und Tag, berechnet aus dem Token-Verbrauch.
- **Terminal** auf node-pty und xterm.js: Claude-Sessions starten, fortsetzen
  und forken, mit Gegendruck-Steuerung und Sitzungs-Wiederherstellung.
- **Aufräumen** in vier getrennten Stufen von „ausblenden“ bis „Dateien
  löschen“, die letzte hinter einem nativen Bestätigungsdialog.
- **Update-Prüfung** gegen die GitHub-Releases, abschaltbar. Signierte und
  notarisierte Ausgaben aktualisieren sich selbst.

[Unveröffentlicht]: https://github.com/Coho04/codestation/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Coho04/codestation/releases/tag/v0.1.0
