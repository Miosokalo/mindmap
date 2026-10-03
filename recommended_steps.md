---
zuletztAktualisiert: "2026-10-04T00:56:19+02:00"
---

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

## Assistenten-Knopf (2026-10-03)

- **Erledigt:** „Chat“ aus der Kopfleiste entfernt. Unten rechts ein runder, funkelnder Knopf; Klick öffnet und schließt das Panel. In der Galerie bleibt er aus.
- **Code:** `index.html`, `css/app.css`, `js/chat.js`, `js/gallery.js`, `README.md`.
- **Deploy:** zusammen mit dem Timeout-Fix ausgeliefert.

## Chat-Antwort lesen (2026-10-03)

- **Erledigt:** „Antwort vom Modell konnte nicht gelesen werden“ kam, wenn das JSON nicht im normalen Text stand (DeepSeek legt es oft ins Feld `reasoning`) oder von Fließtext umgeben war. Der Server liest jetzt beide Felder und sucht das Objekt klammergenau. Zusätzlich verlangt der Aufruf `response_format: json_object`, das Zeitlimit ist 60 s.
- **Prüfung:** Live `POST /api/chat` „erstelle mir eine mindmap zum thema walfang“ → 200, 18 Ops, Wurzel Walfang, kein „Neu“. Log: `ops=18 stop`.
- **Deploy:** Image `webstack-mindmap-api` neu gebaut und gestartet. Im selben Commit wie der übrige Chat-Stand.
- **Code:** `api/server.mjs`.

## Inhaltlich gute Mindmaps (2026-10-03)

- **Erledigt:** Chat legt Knoten still an, der Text bleibt (nicht mehr „Neu“). `add.ref` verkettet Eltern in einer Antwort, höchstens vier Ebenen. Prompt: Stichwort-Baum, ungleiche Tiefe, Platzhalter ersetzen, kein Stil ohne Auftrag.
- **Prüfung:** Auftrag Klimaschutz an die laufende API: Wurzel Klimaschutz, ein tiefer Ast (Energie), die anderen flach, kein „Neu“, keine Stil-Ops. Plus-Knopf öffnet weiter die Eingabe.
- **Deploy:** Images `webstack-mindmap` und `webstack-mindmap-api` neu gebaut und gestartet. Im selben Commit wie der übrige Chat-Stand.
- **Code:** `js/app.js`, `js/chat.js`, `api/server.mjs`, `schema/mindmap.ops.json`, `index.html`, `README.md`.



## Chat-Modell (2026-10-03)

- **Erledigt:** Öffentlicher Chat lief auf `deepseek/deepseek-chat-v3.1:free`. OpenRouter antwortet darauf mit 404 (Gratis-Slug weg). Öffentliches Modell ist jetzt `deepseek/deepseek-chat-v3.1`. Live-Test `POST /api/chat` → 200, Op `add` Wetter.
- **Code:** `api/server.mjs`, `.env.example`, `README.md`, `mindmap/.env`, `docker-compose.override.yml`. Container `mindmap-api` neu erstellt, kein Image-Rebuild nötig.
- **Deploy:** Env-Wechsel ist live. Modell-Slug liegt in diesem Commit.
- **Manuell:** Im Editor Chat öffnen und einen Knoten anlegen lassen.
