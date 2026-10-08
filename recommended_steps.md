---
zuletztAktualisiert: "2026-10-08T21:36:00+02:00"
---

## Schnell-Eingabe (2026-10-08)

- **Erledigt:** Am gewählten Knoten **+++** (Hover: Schnell-Eingabe). Modal mit Fokus im Feld. Enter oder **+** legt ein Kind an und leert das Feld für das nächste. Schließen nur über das **×** (Hover: Schnelleingabe-Modus verlassen). Auswahl bleibt am Elternknoten.
- **Code:** `index.html`, `css/app.css` (`v=48`), `js/app.js` (`v=60`), `js/gallery.js` (`v=29`), `README.md`.
- **Deploy:** Image `webstack-mindmap` neu gebaut und gestartet. Live: `app.css?v=48`, `app.js?v=60`, Button `node-quick`.
- **Prüfung:** Alpha per Enter, Beta per +, leeres Enter legt nichts an, Elternknoten bleibt gewählt, × schließt.

## Stil-Leiste links mit Vorschau (2026-10-08)

- **Erledigt:** Stil öffnet fest links neben der Karte. Optionen stehen untereinander, jede mit kleiner Vorschau (Bereich, Farbe, Linienform, Strich, Anordnung, Knotendarstellung, Rahmen). Auswahl hebt die Zeile hervor und setzt den Stil wie bisher. „Weiter“ bleibt nur bei Kindknoten sichtbar. Der Dock-Schalter oben/seitlich ist weg.
- **Code:** `index.html`, `css/app.css` (`v=47`), `js/app.js`, `README.md`.
- **Deploy:** Image `webstack-mindmap` neu gebaut und gestartet. Live: `app.css?v=47`, Vorschau-Zeilen in `index.html`.
- **Prüfung:** Lokal im Browser: Leiste links, Vorschau-Klick Gerade/Gestrichelt/Fläche/Raute, Schließen, „Weiter“ nach Kindknoten.

## Illustration neu gestalten (2026-10-08)

- **Erledigt:** Neugestaltung bleibt beim Bildmodell, Prompt verlangt zeichengetreue Labels und genau eine Linie pro Kante. Referenz ist PNG bis 2400 px. Dritte Option **Exakt, zum Testen**: Modell malt nur den Hintergrund, die Karte wird pixelgenau darübergelegt.
- **Code:** `api/server.mjs`, `js/app.js`, `index.html` (`app.js?v=59`).
- **Deploy:** Images `webstack-mindmap` und `webstack-mindmap-api` neu gebaut und gestartet. API enthält den Modus `exact`.
- **Offen:** —

## Illustration statt Dauer-Sperre (2026-10-08)

- **Erledigt:** Abgewiesene Aufrufe verlängern das Limit nicht mehr. Illustration: 6 Versuche / 10 Minuten (ohne Zugang), deutsche Meldung. Dialog erklärt: Bild aus der aktuellen Karte, Editor bleibt unverändert, Vorschau und Speichern. Button heißt **Illustration**.
- **Code:** `api/server.mjs`, `index.html`, `css/app.css`, `js/app.js`.
- **Deploy:** Images `webstack-mindmap` und `webstack-mindmap-api` neu gebaut und gestartet.
- **Offen:** —

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

