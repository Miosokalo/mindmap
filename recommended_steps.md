---
zuleztAktualisiert: "2026-10-04T01:32:00+02:00"
---

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

## Rahmen und Strich (2026-10-04)

- **Erledigt:** Rahmen: Abgerundet, Rechteck, Kapsel, Ellipse, Raute. Strich der ausgehenden Linien: Durchgezogen, Gestrichelt, Gepunktet, Strichpunkt. Die Linie endet auf der jeweiligen Form. Bereich gilt wie bei den anderen Stilfeldern.
- **Code:** `js/shape.js`, `js/app.js`, `js/layout.js`, `css/app.css`, `index.html`, `api/server.mjs`, `schema/mindmap.document.json`, `schema/mindmap.ops.json`, `README.md`.
- **Deploy:** mit Qualitätskontrolle-Chat ausgeliefert (Images neu gebaut).

## Chat-Verbindung (2026-10-03)

- **Erledigt:** „Failed to fetch“ — der Browser hat `/api/chat` nach zwei Sekunden verworfen, der Server hat die Antwort danach trotzdem gebaut (ops=4), die Karte blieb unverändert. Die Antwort-Header gehen jetzt sofort raus, bricht die Verbindung ab, wird der Modellanruf gestoppt, und der Client versucht den Aufruf einmal neu. Statt „Failed to fetch“ steht ein deutscher Hinweis. Der Prompt darf „wiederhergestellt“ nicht behaupten, wenn keine Ops da sind; „Entferne“ wird zu delete.
- **Code:** `api/server.mjs`, `js/chat.js`, `index.html`.
- **Deploy:** Images `webstack-mindmap` und `webstack-mindmap-api` neu gebaut. Prüfung: „entferne die Handlungsstrang-Knoten“ → HTTP 200, Op `delete`. Noch nicht committed.

## Umgestalten ohne erfundene Ids (2026-10-03)

- **Erledigt:** „Eltern fehlt: vincent_handlung“ — das Modell hat am neuen Knoten eine eigene `id` gesetzt und die Kinder daran gehängt. Die echte Id vergibt weiter der Browser; so ein Name zählt jetzt als `ref`, auch mit Unterstrich und wenn die Kinder vor dem Eltern-Op stehen.
- **Code:** `api/server.mjs`, `js/chat.js`, `schema/mindmap.ops.json`, `index.html`, `README.md`.
- **Deploy:** Images neu gebaut. Noch nicht committed.

## Tiefer-Auftrag ohne Abbruch (2026-10-03)

- **Erledigt:** „Das Modell hat zu lange gebraucht“ kam, weil DeepSeek die Minute im Denkfeld verbracht hat und der Antworttext leer blieb. Der Aufruf schaltet das Denkfeld aus. Nachträge wie „tiefer“ ergänzen nur zwei, drei Äste, statt die Karte neu zu bauen.
- **Deploy:** Images `webstack-mindmap` und `webstack-mindmap-api` neu gebaut (Assistenten-Knopf und Timeout-Fix).

