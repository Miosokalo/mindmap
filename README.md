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
- **Anordnen** legt Linien neu. Der Knoten selbst bleibt, wo er steht
- **Bereich** gilt für Farbe, Linienform, Linienlänge, Knotendarstellung, Anordnung und Anordnen
- **Länge** setzt den Abstand der ausgehenden Linien. Kurz zieht die Kinder heran, lang rückt sie weg
- **Nur Auswahl** ändert den markierten Knoten und seine ausgehenden Linien. Die Anordnung rückt die direkten Kinder zurecht; deren Unterpunkte behalten die Lage zueinander
- **Gesamter Unterbaum** schreibt denselben Wert auf alle Nachfahren und legt den ganzen Zweig neu
- **Anker** blendet die Punkte am gewählten Knoten ein oder aus. Ein Klick auf eine Linie zeigt ihren Punkt trotzdem. Bei nahem Zoom erscheint er auch unter dem Zeiger; weit herausgezoomt nicht
- **Rundherum** verteilt die ausgehenden Linien gleichmäßig auf die Kanten. Die Punkte lassen sich ziehen und rasten an der nächsten Kante ein. Anordnen und ein neuer Unterpunkt setzen das zurück
- **Bild** speichert die ganze Karte als PNG, unabhängig vom Ausschnitt
- **Gleichmäßig** legt die Striche wie eine Sonne in den freien Bogen: rechts, schräg, oben, schräg links und links, soweit dort Platz ist und nicht der Elternknoten steht
- **Weiter** lässt die Unterpunkte in der Richtung des Elternknotens weiterlaufen
- Oben–Unten setzt die Striche an die Ober- und Unterkante, die Wörter stehen darüber oder darunter
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

Ein Knoten kann `colorMode` (`color`, `mono`), `line` (`curve`, `straight`, `elbow`), `look` (`mixed`, `filled`, `outline`, `text`) und `reach` tragen. `reach` ist der zusätzliche Abstand der ausgehenden Linien in Weltpixeln; fehlt er, gilt 14. Fehlt eines der anderen Felder, gilt der globale Stil. `port` ist `{ side, t }` und setzt den Start der Linie am Elternknoten: `side` ist `n`, `e`, `s` oder `w`, `t` läuft von 0 bis 1 auf dieser Kante.

`setDocument` ersetzt die Karte und prüft diese Struktur. `relayout(id)` ordnet nur die direkten Kinder von `id` neu an; deren Unterpunkte behalten die Lage zueinander. `relayout(id, { deep: true })` ordnet alle Nachfahren neu. Beides entfernt von Hand gesetzte Anschlüsse an den neu gelegten Linien. `setStyle` ändert die globalen Stilfelder. Ein neues `layout` setzt die Anordnung des Ursprungs und ordnet von dort nur dessen direkte Kinder neu. Die Anordnung eines anderen Knotens steht in `node.flow`.

Eine neue Karte aus einem Baum erzeugt `buildTreeNodes(tree)` und danach `relayoutNodes(nodes, style, "root", textWidth)`.

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
