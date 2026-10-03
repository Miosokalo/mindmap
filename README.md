# Mindmap

Mindmap im Browser. Kein Build, keine Anmeldung. Die Karte liegt lokal im Browser und lässt sich als JSON-Dokument lesen und schreiben.

## Start

```bash
python3 -m http.server 8777
```

Dann `http://127.0.0.1:8777` öffnen.

## Bedienung

- Knoten wählen, ziehen, per Doppelklick umbenennen
- Über dem gewählten Knoten: **+** legt ein Kind an, der Mülleimer löscht erst beim zweiten Klick
- **+ Kind** oder Tab legt einen Unterpunkt an
- **Anordnen** liegt bei Layout und legt nur die ausgehenden Linien des ausgewählten Knotens neu. Der Knoten selbst bleibt, wo er steht. Der Bereich ändert daran nichts
- **Bereich** gilt für Farbe, Linienform, Strichlänge, Knotendarstellung und Anordnung
- **Strichlänge** setzt den Abstand der ausgehenden Linien. Kurz zieht die Kinder heran, lang rückt sie weg
- **Nur Auswahl** ändert den markierten Knoten und seine ausgehenden Linien. Die Anordnung rückt die direkten Kinder zurecht; deren Unterpunkte behalten die Lage zueinander
- **Gesamter Unterbaum** schreibt denselben Wert auf alle Nachfahren und legt den ganzen Zweig neu
- **Anker** blendet die Punkte am gewählten Knoten ein oder aus. Ein Klick auf eine Linie zeigt ihren Punkt trotzdem. Bei nahem Zoom erscheint er auch unter dem Zeiger; weit herausgezoomt nicht
- **Rundherum** verteilt die ausgehenden Linien gleichmäßig auf die Kanten. Die Punkte lassen sich ziehen und rasten an der nächsten Kante ein. Anordnen und ein neuer Unterpunkt setzen das zurück
- **Download** speichert die ganze Karte als PNG oder PDF, unabhängig vom Ausschnitt
- **Gleichmäßig** legt die Striche wie eine Sonne in den freien Bogen: rechts, schräg, oben, schräg links und links, soweit dort Platz ist und nicht der Elternknoten steht
- **Weiter** lässt die Unterpunkte in der Richtung des Elternknotens weiterlaufen
- Oben–Unten setzt die Striche an die Ober- und Unterkante, die Wörter stehen darüber oder darunter
- Entf löscht den gewählten Knoten, nicht die Wurzel. Die Kinder bleiben und hängen danach an seinem Elternknoten

## Für andere Agents

Im Browser gibt es `window.Mindmap`:

```javascript
const doc = Mindmap.getDocument();
Mindmap.setStyle({ layout: "vertical", line: "straight" });
Mindmap.relayout("root");
Mindmap.downloadImage();
Mindmap.downloadPdf();
Mindmap.setDocument(doc);
```

`getDocument()` liefert `{ version, style, camera, nodes }`. Das Schema steht in `schema/mindmap.document.json`. `nodes.root` ist Pflicht. `parentId` muss auf einen vorhandenen Knoten zeigen. `dir` ist `n`, `e`, `s` oder `w`.

Ein Knoten kann `colorMode` (`color`, `mono`), `line` (`curve`, `straight`, `elbow`), `look` (`mixed`, `filled`, `outline`, `text`) und `reach` tragen. `reach` ist der zusätzliche Abstand der ausgehenden Linien in Weltpixeln; fehlt er, gilt 14. Fehlt eines der anderen Felder, gilt der globale Stil. `port` ist `{ side, t }` und setzt den Start der Linie am Elternknoten: `side` ist `n`, `e`, `s` oder `w`, `t` läuft von 0 bis 1 auf dieser Kante.

`setDocument` ersetzt die Karte und prüft diese Struktur. `relayout(id)` ordnet nur die direkten Kinder von `id` neu an; deren Unterpunkte behalten die Lage zueinander. `relayout(id, { deep: true })` ordnet alle Nachfahren neu. Beides entfernt von Hand gesetzte Anschlüsse an den neu gelegten Linien. `setStyle` ändert die globalen Stilfelder. Ein neues `layout` setzt die Anordnung des Ursprungs und ordnet von dort nur dessen direkte Kinder neu. Die Anordnung eines anderen Knotens steht in `node.flow`.

Eine neue Karte aus einem Baum erzeugt `buildTreeNodes(tree)` und danach `relayoutNodes(nodes, style, "root", textWidth)`.

## Chat-Assistent (OpenRouter)

Unten rechts öffnet der funkelnde Assistenten-Knopf ein Panel. Der Assistent ändert die Karte auf Zuruf, z. B. „Füge unter der Wurzel einen Knoten Wetter an“ oder „Lösche alles zu Insekten“.

- `js/chat.js` schickt den kompakten Baum (`id`, `parentId`, `text`, `order`, `color`, `dir`) und den Auftrag an `POST /api/chat` — gleicher Ursprung, ohne Koordinaten.
- `api/server.mjs` (Zero-Dependency-Node) hält den OpenRouter-Key **nur serverseitig** und ruft `https://openrouter.ai/api/v1/chat/completions` auf.
- Das Modell antwortet mit `{ reply, ops }`; `ops` folgen `schema/mindmap.ops.json` und werden über die vorhandenen Funktionen (`addChild`, `deleteNode`, `Mindmap.setStyle`, `relayoutNodes`) angewandt. Ein `add` darf `ref` setzen; spätere Ops derselben Antwort nutzen diese `ref` als `parentId`, damit ein Baum in einem Zug entsteht. Ungültige Ops werden übersprungen, die Karte bleibt immer valide.
- Ohne Zugang: günstiges Modell mit strengem Rate-Limit (Caddy + Proxy). Der frühere Slug `deepseek/deepseek-chat-v3.1:free` ist bei OpenRouter nicht mehr verfügbar. Mit Zugang (**Schlüssel** im Panel, Basic Auth): bessere Modelle.
- `GET /api/health` zeigt Modellkonfiguration und ob der Key gesetzt ist.

Serverseitige Umgebung (`mindmap/.env`, Vorlage `mindmap/.env.example`): `OPENROUTER_API_KEY`, `OPENROUTER_MODEL_PUBLIC`, `OPENROUTER_MODEL_AUTH`, `MINDMAP_CHAT_AUTH_USER`, `MINDMAP_CHAT_AUTH_HASH` (Format `scrypt$<saltHex>$<hashHex>`). Key: https://openrouter.ai/keys

## Galerie (Community)

Beim Besuch startet die Seite mit einem großen **Neue Mindmap erstellen** und der **Galerie** darunter. Jede Karte bleibt lokal im Browser — privat. Veröffentlichen geschieht nie automatisch, sondern nur über **Veröffentlichen …** mit gesicherter Nachfrage: im Dialog muss man **veröffentlichen** eintippen, bevor der Button frei wird. Veröffentlicht wird das ganze Dokument (alle Knotentexte, Stil) — dauerhaft, öffentlich, ohne Lösch-Button.

- `GET /api/maps` → Liste; `GET /api/maps/<id>` → Dokument; `POST /api/maps` → veröffentlichen (Body `{document, title?}`, Server-Limit: 3 pro Tag und IP, Dokument wird gesäubert/validiert).
- Speicher: Docker-Volume `webstack_mindmap_data`, eine JSON-Datei pro Karte unter `/data/maps/`.
- Erster Start: die Galerie wird mit der **Pflanzenschutz**-Karte geseedet (derselbe Baum wie der Frontend-Default in `js/pflanzenschutz.js`).
- **Löschen (nur Admin, serverseitig):** Karte entfernen mit
  `docker run --rm -v webstack_mindmap_data:/data alpine rm /data/maps/<id>.json` —
  die Galerie liest live, kein Neustart nötig.
- Öffnen einer Galerie-Karte: sie wird als **lokal bearbeitbare Kopie** geöffnet (ersetzt die aktuelle Karte nach Rückfrage); die veröffentlichte Karte auf dem Server bleibt davon unberührt. Ein Kopie-Banner weist darauf hin; **Zurück zur Galerie** behält die Kopie als eigene Karte.

## Bereitstellen

Die Dateien sind statisch und können so auf einen Webserver, zum Beispiel nginx auf Hetzner:

```nginx
server {
    server_name mindmap.example.org;
    root /var/www/mindmap;
    index index.html;
}
```

Es gibt kein Backend. Jeder Browser speichert seine Karte selbst. Wer Karten serverseitig halten will, speichert das JSON aus `Mindmap.getDocument()`.
