---
zuletztAktualisiert: "2026-10-03T17:11:00+02:00"
---

## Quick-Actions und Linienenden (2026-10-03)

- **Erledigt:** Über dem gewählten Knoten **+** (Kind) und Mülleimer. Löschen erst beim zweiten Klick. Der Knoten fällt weg, direkte Kinder bleiben am Elternknoten, Positionen bleiben. Kanten enden auf dem abgerundeten Rahmen (`js/shape.js`, `contains` als Vertrag für spätere Formen).
- **Code:** `js/shape.js`, `js/app.js`, `css/app.css`, `index.html`, `README.md`, Chat-Prompt in `api/server.mjs`.
- **Deploy:** `6b54991` auf `main`, Images `webstack-mindmap` und `webstack-mindmap-api` neu gebaut, Container neu gestartet. Live: https://mindmap.orga-hero.com (`shape.js?v=1`, `/api/health` ok).
- **Manuell:** Knoten anklicken, Leiste prüfen, Mülleimer einmal und zweimal, Kind mit eigenem Unterpunkt löschen. Gerade, Kurve und Winkel an einer Ecke ansehen.
- **Offen:** Weitere Knotenformen (Ellipse, Raute) nur als neue `contains`-Form.
