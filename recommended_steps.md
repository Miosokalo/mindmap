---
zuletztAktualisiert: "2026-10-06T08:30:21+02:00"
---

## Klick ins Leere hebt Auswahl auf (2026-10-06)

- **Erledigt:** Klick auf die freie Fläche (ohne Ziehen) setzt `selectedId` auf null. Der Auswahl-Chip verschwindet, das Knoten-Menü auch. Ziehen zum Verschieben lässt die Auswahl stehen.
- **Code:** `js/app.js`, `index.html` (`app.js?v=56`).
- **Deploy:** Image `webstack-mindmap` neu gebaut und gestartet.

## Chat-Zeitlimit und Wartezeilen (2026-10-06)

- **Erledigt:** OpenRouter-Timeout von 60s auf 3 Minuten (`OPENROUTER_TIMEOUT_MS`). Chat-Wartezeit rotiert alle 4s durch gemischte Statuszeilen (Thema, Tiefe, Linien, Knoten); die Qualitätskontrolle hat eigene Zeilen.
- **Code:** `api/server.mjs`, `js/chat.js`.
- **Deploy:** Images `webstack-mindmap` und `webstack-mindmap-api` neu gebaut und gestartet.
- **Offen:** —

## Stil-Leiste Dock Top/Side (2026-10-04)

- **Erledigt:** Stil klappt unter der Topbar nach unten aus (keine Floating-Card). Switch-Button in der Leiste kippt zwischen oberer Leiste und linker Sidebar; Präferenz in `localStorage`. Escape/Schließen bleibt.
- **Code:** `index.html`, `css/app.css`, `js/app.js`, `js/gallery.js`, `README.md`.
- **Deploy:** Image `webstack-mindmap` neu gebaut.

## UI Refresh (2026-10-04)

- **Erledigt:** Frisches Cool-Hell-UI (DM Sans, Teal-Akzent). Slim-Topbar mit Selected-Chip; doppelte +Kind/Löschen entfernt. Layout-Leiste → einklappbares Stil-Panel (Gruppen Bereich/Linien/Knoten). Button-Hierarchie primary/ghost. Start, Galerie, Chat, Dialoge angeglichen.
- **Code:** `index.html`, `css/app.css`, `js/app.js`, `js/gallery.js`, `README.md`.
- **Deploy:** Image `webstack-mindmap` neu gebaut.
- **Manuell:** Startseite, Editor-Topbar, Stil öffnen/Escape, Node-Popup, Verzaubern/Assistent.

## Undo/Redo Strg+Z/Y (2026-10-04)

- **Erledigt:** Verlaufsstapel (max. 50) für Kartenänderungen. **Strg+Z** rückgängig, **Strg+Y** / **Strg+Umschalt+Z** wiederherstellen. Greift bei Knoten, Text, Stil, Icons, Anordnen, Ziehen, Chat (ein Schritt pro Assistenten-Antwort). Pan/Zoom und Auswahl ohne Eintrag. Neue Karte leert den Verlauf.
- **Code:** `js/app.js`, `js/chat.js`, `index.html`, `README.md`.
- **Deploy:** Image `webstack-mindmap` neu gebaut.
- **Offen:** Commit noch offen.

## Icon pro Knoten (Popup) (2026-10-04)

- **Erledigt:** Am Knoten-Popup (+ / Löschen) neuer Button **Icon**: ohne Icon → Dialog KI oder Bild (Galerie / Datei vom PC); mit Icon → Entfernen. Galerie durchsuchbar; Datei wird clientseitig zu PNG und per `POST /api/icons/upload` als `gen:<id>` gespeichert.
- **Code:** `index.html`, `css/app.css`, `js/app.js`, `api/server.mjs`, `README.md`.
- **Deploy:** Images neu gebaut/gestartet.
- **Prüfung:** Galerie → `lucide:wind`; Entfernen; KI → `lucide:atom`; Upload API 200.
- **Offen:** Commit noch offen.

## Live-Retest KI + Sprache/Scope (2026-10-04)

- **Erledigt:** Live-Test Chat/Icons/Verzaubern/Review. Chat + Review ok; Icons (KI) auf Scope children setzt passende Lucide-Icons. Verzaubern zeigt klaren Hinweis bei fehlendem OpenRouter-Guthaben (402). Qualitätsfix: gemischt englische Stichworte trotz deutschem Auftrag; neuer Map behielt alten Style-Bereich. Prompt: Knotentexte in Auftragssprache; Review erkennt falsche Sprache. `setDocument` setzt Scope auf `node` zurück.
- **Prüfung:** Photosynthese-Chat → deutsche Labels, Kontrolle ok, 6 Icons. API Kreislaufwirtschaft → „Reduzieren/Wiederverwenden/Recyceln“, „Biologischer/Technischer Kreislauf“. Scope subtree → neue Karte → UI „Nur Auswahl“.
- **Code:** `api/server.mjs`, `js/app.js`.
- **Deploy:** Images `webstack-mindmap` und `webstack-mindmap-api` neu gebaut und gestartet.
- **Offen:** Image-Gen/Verzaubern braucht OpenRouter-Credits; Commit der Fixes noch offen.

## Verzaubern-Button (2026-10-04)

- **Erledigt:** Button **Verzaubern** in der Kopfleiste. Dialog: mit/ohne atmosphärischen Hintergrund. Client sendet Referenzbild (JPEG) + Hierarchie-Text an `POST /api/enchant`; OpenRouter-Bildmodell liefert Illustration; Vorschau + PNG-Download.
- **Code:** `index.html`, `css/app.css`, `js/app.js`, `api/server.mjs`, `README.md`.
- **Deploy:** Images neu bauen.
- **Manuell:** Editor → Verzaubern → beide Hintergrund-Optionen; bei fehlendem OpenRouter-Guthaben klarer Fehlerhinweis.

## Scope Kinder + Icons/Image-Gen (2026-10-04)

- **Erledigt:** Style-Bereich um „Auswahl + nächste Ebene“ (`children`). Icons am Knoten (`lucide:` / `gen:`), Lucide-Pack (~181) + Katalog im Repo, Style-Button **Icons (KI)**, Chat-Op `icon`/`auto`, API `GET/POST /api/icons*`, generierte PNGs unter `/data/icons` (Volume), Image-Gen via OpenRouter (`OPENROUTER_MODEL_IMAGE`).
- **Code:** `js/app.js`, `js/chat.js`, `css/app.css`, `index.html`, `api/server.mjs`, `icons/*`, Schemas, Dockerfiles, `README.md`, `.env.example`.
- **Deploy:** Images neu bauen/starten.
- **Manuell:** Bereich „Auswahl + nächste Ebene“ → Farbe; **Icons (KI)**; Chat „setze Icons auf die Hauptäste“. Lucide-Assign live ok. Image-Gen braucht OpenRouter-Guthaben (aktuell 402 Insufficient credits) — danach wächst `/data/icons`.

## Qualitätskontrolle Chat (2026-10-04)

- **Erledigt:** Live-Tests (Photosynthese, Vertiefen, Stil): Inhalt oft brauchbar, aber Hierarchie-Fehler (Teil-von als Geschwister), Doppelungen, einfarbige Äste, Stil-Ops manchmal fehlend. Prompt geschärft (Hierarchie, Farben an Hauptästen, Layout-/Dash-Mapping). Feedback-Kontroll-Loop: nach strukturellen Ops läuft `mode: "review"` im Hintergrund, Ergebnis bleibt sichtbar; Korrektur nur nach Popup-Bestätigung.
- **Code:** `api/server.mjs`, `js/chat.js`, `css/app.css`, `index.html`, `schema/mindmap.ops.json`, `README.md`.
- **Deploy:** Images `webstack-mindmap` und `webstack-mindmap-api` neu gebaut und gestartet.
- **Manuell:** Neue Mindmap → Assistent „Mindmap zu X“ → prüfen, ob Farben und Kontrolle erscheinen; bei Popup Ja/Nein; Stil „links-rechts + gestrichelt“.

