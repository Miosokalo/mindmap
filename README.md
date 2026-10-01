# Mindmap

Ein kleines Mindmap-Tool im Browser: Knoten anlegen, beschriften, verschieben und die Karte ziehen.

## Start

```bash
python3 -m http.server 8765
```

Dann im Browser `http://127.0.0.1:8765` öffnen.

## Bedienung

- Knoten anklicken, um ihn auszuwählen
- **Kind** oder Tab legt einen Unterknoten an
- Doppelklick bearbeitet den Text
- Ziehen verschiebt einen Knoten, Ziehen auf der Fläche verschiebt die Karte
- Mausrad zoomt
- Entf löscht den ausgewählten Knoten (nicht die Wurzel)
