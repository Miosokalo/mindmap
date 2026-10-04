---
# Archiv — nicht für Agenten-Start lesen
---

## Quick-Actions und Linienenden (2026-10-03)

- **Erledigt:** Über dem gewählten Knoten **+** (Kind) und Mülleimer. Löschen erst beim zweiten Klick. Der Knoten fällt weg, direkte Kinder bleiben am Elternknoten, Positionen bleiben. Kanten enden auf dem abgerundeten Rahmen (`js/shape.js`, `contains` als Vertrag für spätere Formen).
- **Code:** `js/shape.js`, `js/app.js`, `css/app.css`, `index.html`, `README.md`, Chat-Prompt in `api/server.mjs`.
- **Deploy:** `6b54991` auf `main`, Images `webstack-mindmap` und `webstack-mindmap-api` neu gebaut, Container neu gestartet. Live: https://mindmap.orga-hero.com (`shape.js?v=1`, `/api/health` ok).
- **Manuell:** Knoten anklicken, Leiste prüfen, Mülleimer einmal und zweimal, Kind mit eigenem Unterpunkt löschen. Gerade, Kurve und Winkel an einer Ecke ansehen.
- **Offen:** Weitere Knotenformen (Ellipse, Raute) nur als neue `contains`-Form.

## Chat-Modell (2026-10-03)

- **Erledigt:** Öffentlicher Chat lief auf `deepseek/deepseek-chat-v3.1:free`. OpenRouter antwortet darauf mit 404 (Gratis-Slug weg). Öffentliches Modell ist jetzt `deepseek/deepseek-chat-v3.1`. Live-Test `POST /api/chat` → 200, Op `add` Wetter.
- **Code:** `api/server.mjs`, `.env.example`, `README.md`, `mindmap/.env`, `docker-compose.override.yml`. Container `mindmap-api` neu erstellt, kein Image-Rebuild nötig.
- **Deploy:** Env-Wechsel ist live. Modell-Slug liegt in diesem Commit.
- **Manuell:** Im Editor Chat öffnen und einen Knoten anlegen lassen.
## Inhaltlich gute Mindmaps (2026-10-03)

- **Erledigt:** Chat legt Knoten still an, der Text bleibt (nicht mehr „Neu“). `add.ref` verkettet Eltern in einer Antwort, höchstens vier Ebenen. Prompt: Stichwort-Baum, ungleiche Tiefe, Platzhalter ersetzen, kein Stil ohne Auftrag.
- **Prüfung:** Auftrag Klimaschutz an die laufende API: Wurzel Klimaschutz, ein tiefer Ast (Energie), die anderen flach, kein „Neu“, keine Stil-Ops. Plus-Knopf öffnet weiter die Eingabe.
- **Deploy:** Images `webstack-mindmap` und `webstack-mindmap-api` neu gebaut und gestartet. Im selben Commit wie der übrige Chat-Stand.
- **Code:** `js/app.js`, `js/chat.js`, `api/server.mjs`, `schema/mindmap.ops.json`, `index.html`, `README.md`.

## Chat-Antwort lesen (2026-10-03)

- **Erledigt:** „Antwort vom Modell konnte nicht gelesen werden“ kam, wenn das JSON nicht im normalen Text stand (DeepSeek legt es oft ins Feld `reasoning`) oder von Fließtext umgeben war. Der Server liest jetzt beide Felder und sucht das Objekt klammergenau. Zusätzlich verlangt der Aufruf `response_format: json_object`, das Zeitlimit ist 60 s.
- **Prüfung:** Live `POST /api/chat` „erstelle mir eine mindmap zum thema walfang“ → 200, 18 Ops, Wurzel Walfang, kein „Neu“. Log: `ops=18 stop`.
- **Deploy:** Image `webstack-mindmap-api` neu gebaut und gestartet. Im selben Commit wie der übrige Chat-Stand.
- **Code:** `api/server.mjs`.

## Assistenten-Knopf (2026-10-03)

- **Erledigt:** „Chat“ aus der Kopfleiste entfernt. Unten rechts ein runder, funkelnder Knopf; Klick öffnet und schließt das Panel. In der Galerie bleibt er aus.
- **Code:** `index.html`, `css/app.css`, `js/chat.js`, `js/gallery.js`, `README.md`.
- **Deploy:** zusammen mit dem Timeout-Fix ausgeliefert.

## Tiefer-Auftrag ohne Abbruch (2026-10-03)

- **Erledigt:** „Das Modell hat zu lange gebraucht“ kam, weil DeepSeek die Minute im Denkfeld verbracht hat und der Antworttext leer blieb. Der Aufruf schaltet das Denkfeld aus. Nachträge wie „tiefer“ ergänzen nur zwei, drei Äste, statt die Karte neu zu bauen.
- **Deploy:** Images `webstack-mindmap` und `webstack-mindmap-api` neu gebaut (Assistenten-Knopf und Timeout-Fix).

## Umgestalten ohne erfundene Ids (2026-10-03)

- **Erledigt:** „Eltern fehlt: vincent_handlung“ — das Modell hat am neuen Knoten eine eigene `id` gesetzt und die Kinder daran gehängt. Die echte Id vergibt weiter der Browser; so ein Name zählt jetzt als `ref`, auch mit Unterstrich und wenn die Kinder vor dem Eltern-Op stehen.
- **Code:** `api/server.mjs`, `js/chat.js`, `schema/mindmap.ops.json`, `index.html`, `README.md`.
- **Deploy:** Images neu gebaut. Noch nicht committed.

