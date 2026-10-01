# Mindmap

Mindmap im Browser. Kein Build, keine Anmeldung. Die Karte liegt lokal im Browser und lässt sich als JSON-Dokument lesen und schreiben.

## Start

```bash
python3 -m http.server 8777
```

Dann `http://127.0.0.1:8777` öffnen.

## Bedienung

- Knoten wählen, ziehen, per Doppelklick umbenennen
- **Kind** oder Tab legt einen Unterpunkt an
- **Anordnen** legt die Unterpunkte des gewählten Knotens neu aus. Der Knoten selbst bleibt, wo er steht
- **Bild** speichert die ganze Karte als PNG, unabhängig vom Ausschnitt
- **Anordnung** gilt nur für den gewählten Knoten. Für die ganze Karte zuerst den Ursprung anklicken
- **Gleichmäßig** legt die Striche wie eine Sonne in den freien Bogen: rechts, schräg, oben, schräg links und links, soweit dort Platz ist und nicht der Elternknoten steht
- **Weiter** lässt die Unterpunkte in der Richtung des Elternknotens weiterlaufen
- Oben–Unten setzt die Striche an die Ober- und Unterkante, die Wörter stehen darüber oder darunter
- Farbe, Linienform und Knotendarstellung sind weitere Stile
- Entf löscht den gewählten Knoten, nicht die Wurzel

## Für andere Agents

Im Browser gibt es `window.Mindmap`:

```javascript
const doc = Mindmap.getDocument();
Mindmap.setStyle({ layout: "vertical", line: "straight" });
Mindmap.relayout("root");
Mindmap.downloadImage();
Mindmap.setDocument(doc);
```

`getDocument()` liefert `{ version, style, camera, nodes }`. Das Schema steht in `schema/mindmap.document.json`. `nodes.root` ist Pflicht. `parentId` muss auf einen vorhandenen Knoten zeigen. `dir` ist `n`, `e`, `s` oder `w`.

`setDocument` ersetzt die Karte und prüft diese Struktur. `relayout(id)` ordnet nur die Nachkommen von `id` neu an. `setStyle` ändert die Stilfelder. Ein neues `layout` setzt die Anordnung des Ursprungs und ordnet die Karte von dort neu; die Anordnung eines anderen Knotens steht in `node.flow`.

Eine neue Karte aus einem Baum erzeugt `buildTreeNodes(tree)` und danach `relayoutNodes(nodes, style, "root", textWidth)`.

## Chat-Assistent (OpenRouter)

Über **Chat** in der Kopfleiste öffnet sich ein Panel. Der Assistent ändert die Karte auf Zuruf, z. B. „Füge unter der Wurzel einen Knoten Wetter an“ oder „Lösche alles zu Insekten“.

- `js/chat.js` schickt den kompakten Baum (`id`, `parentId`, `text`, `order`, `color`, `dir`) und den Auftrag an `POST /api/chat` — gleicher Ursprung, ohne Koordinaten.
- `api/server.mjs` (Zero-Dependency-Node) hält den OpenRouter-Key **nur serverseitig** und ruft `https://openrouter.ai/api/v1/chat/completions` auf.
- Das Modell antwortet mit `{ reply, ops }`; `ops` folgen `schema/mindmap.ops.json` und werden über die vorhandenen Funktionen (`addChild`, `deleteNode`, `Mindmap.setStyle`, `relayoutNodes`) angewandt. Ungültige Ops werden übersprungen, die Karte bleibt immer valide.
- Ohne Zugang: kleines/günstiges Modell mit strengem Rate-Limit (Caddy + Proxy). Mit Zugang (**Schlüssel** im Panel, Basic Auth): bessere Modelle.
- `GET /api/health` zeigt Modellkonfiguration und ob der Key gesetzt ist.

Serverseitige Umgebung (Webstack `.env`): `OPENROUTER_API_KEY`, `OPENROUTER_MODEL_PUBLIC`, `OPENROUTER_MODEL_AUTH`, `MINDMAP_CHAT_AUTH_USER`, `MINDMAP_CHAT_AUTH_HASH` (Format `scrypt$<saltHex>$<hashHex>`).

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
