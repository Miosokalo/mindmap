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
