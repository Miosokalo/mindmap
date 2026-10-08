/**
 * Mindmap-API (Zero-Dependency, node:http).
 *
 * Chat:
 *   POST /api/chat  { document, instruction, history?, mode? } -> { reply, ops, model, authed, mode, needsCorrection?, reason? }
 *        mode "review": Qualitätskontrolle nach einer Änderung; Korrektur-Ops nur vorschlagen.
 *   GET  /api/health -> { ok, modelPublic, modelAuth, keyConfigured, modelImage }
 *
 * Icons:
 *   GET  /api/icons              -> { icons: [{ id, kind, label, tags, url }] }
 *   GET  /api/icons/gen/<id>     -> PNG der generierten Icons
 *   POST /api/icons/assign       { targets:[{id,text}], allowGenerate? } -> { assignments, created, model }
 *   POST /api/icons/upload       { image (data-URL), label? } -> { icon: "gen:<id>", entry }
 *
 * Verzaubern (grafische Mindmap-Illustration):
 *   POST /api/enchant  { mode?, image?, tree?, background?, title?, width?, height? } -> { image, model, mode }
 *        mode "restyle" (Default): Bildmodell zeichnet die Karte neu, image ist Pflicht.
 *        mode "exact": Bildmodell malt nur den Hintergrund, ohne Kartenbild und ohne Knotentexte.
 *
 * Galerie (Community-Mindmaps, jede Karte eine JSON-Datei unter DATA_DIR):
 *   GET  /api/maps        -> { maps: [{ id, title, nodeCount, publishedAt }] }
 *   GET  /api/maps/<id>   -> { id, title, nodeCount, publishedAt, document }
 *   POST /api/maps        { document, title? } -> { id, title, nodeCount }
 *        Öffentlich; zusätzliches Limit: 3 Veröffentlichungen pro Tag und IP.
 *
 * OpenRouter-Key und Basic-Auth-Zugang liegen nur hier (ENV), nie im Frontend.
 * Erster Start: ggf. Galerie mit der Pflanzenschutz-Karte seeden
 * (gleicher Baum wie der Frontend-Default in js/pflanzenschutz.js).
 */
import http from "node:http";
import crypto from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const PORT = Number(process.env.PORT || 3000);
const OPENROUTER_API_KEY = (process.env.OPENROUTER_API_KEY || "").trim();
const MODEL_PUBLIC = (process.env.OPENROUTER_MODEL_PUBLIC || "deepseek/deepseek-chat-v3.1").trim();
const MODEL_AUTH = (process.env.OPENROUTER_MODEL_AUTH || "anthropic/claude-sonnet-4.5").trim();
const AUTH_USER = (process.env.MINDMAP_CHAT_AUTH_USER || "").trim();
const AUTH_HASH = (process.env.MINDMAP_CHAT_AUTH_HASH || "").trim();
const DATA_DIR = (process.env.DATA_DIR || "/data/maps").trim();
const ICONS_DIR = (process.env.ICONS_DIR || "/data/icons").trim();
const ICONS_CATALOG = (process.env.ICONS_CATALOG || join(process.cwd(), "icons-catalog.json")).trim();
const MODEL_IMAGE = (process.env.OPENROUTER_MODEL_IMAGE || "black-forest-labs/flux.2-pro").trim();

const RATE_ANON_MAX = 10;
const RATE_ANON_WINDOW_MS = 5 * 60 * 1000;
const RATE_AUTH_MAX = 60;
const RATE_AUTH_WINDOW_MS = 5 * 60 * 1000;
const PUBLISH_MAX_PER_DAY = 3;
const PUBLISH_WINDOW_MS = 24 * 60 * 60 * 1000;
const RATE_ICON_ANON_MAX = 6;
const RATE_ICON_AUTH_MAX = 30;
const RATE_ICON_UPLOAD_ANON_MAX = 12;
const RATE_ICON_UPLOAD_AUTH_MAX = 40;
const MAX_ASSIGN_TARGETS = 40;
const MAX_GENERATE_PER_ASSIGN = 5;
const ICON_REF_RE = /^(lucide|gen):[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const GEN_ID_RE = /^[a-z0-9]{8,24}$/;

const MAX_BODY_BYTES = 256 * 1024;
const MAX_ICON_UPLOAD_BODY_BYTES = 1.5 * 1024 * 1024;
const MAX_ICON_UPLOAD_BYTES = 400 * 1024;
const MAX_ENCHANT_BODY_BYTES = 3 * 1024 * 1024;
const RATE_ENCHANT_ANON_MAX = 6;
const RATE_ENCHANT_AUTH_MAX = 20;
const RATE_ENCHANT_WINDOW_MS = 10 * 60 * 1000;
const MAX_ENCHANT_IMAGE_CHARS = 2.5 * 1024 * 1024;
const MAX_ENCHANT_TREE_NODES = 120;
const MAX_TREE_NODES = 600;
const MAX_INSTRUCTION_CHARS = 2000;
const MAX_HISTORY_ITEMS = 6;
const MAX_REPLY_CHARS = 600;
// Komplexe Karten (tiefe Bäume, viele Ops) brauchen oft länger als eine Minute.
const OPENROUTER_TIMEOUT_MS = 180 * 1000;
const MAX_OUTPUT_TOKENS = 2048;
const NODE_TEXT_MAX = 200;
const MAX_TITLE_CHARS = 80;
const MAX_GALLERY_LIST = 200;
const MAP_ID_RE = /^[a-z0-9-]{1,24}$/;

const NODE_COLORS = new Set(["gold", "green", "cyan", "blue", "orange", "root"]);

// ---------- Helfer ----------

function log(...args) {
  console.log(new Date().toISOString(), "[mindmap-api]", ...args);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  if (res.headersSent) {
    res.end(body);
    return;
  }
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function holdOpen(res) {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  res.write("\n");
}

function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function readBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ---------- Basic Auth (scrypt$saltHex$hashHex) ----------

function verifyBasicAuth(header) {
  if (!AUTH_USER || !AUTH_HASH) return false;
  const match = /^Basic\s+(.+)$/i.exec(String(header || "").trim());
  if (!match) return false;
  let decoded = "";
  try {
    decoded = Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    return false;
  }
  const idx = decoded.indexOf(":");
  if (idx < 0) return false;
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  if (user.length !== AUTH_USER.length) return false;
  const userOk = crypto.timingSafeEqual(Buffer.from(user), Buffer.from(AUTH_USER));
  if (!userOk) return false;
  const parts = AUTH_HASH.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  let expected;
  try {
    expected = Buffer.from(parts[2], "hex");
    if (expected.length === 0) return false;
    const actual = crypto.scryptSync(pass, Buffer.from(parts[1], "hex"), expected.length);
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ---------- Rate-Limit (In-Memory, zusätzlich zu Caddy) ----------

const rateBuckets = new Map();

function rateOk(key, max, windowMs) {
  const now = Date.now();
  const arr = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    rateBuckets.set(key, arr);
    return false;
  }
  arr.push(now);
  rateBuckets.set(key, arr);
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) if (v.every((t) => now - t >= windowMs)) rateBuckets.delete(k);
  }
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateBuckets) if (v.every((t) => now - t >= PUBLISH_WINDOW_MS)) rateBuckets.delete(k);
}, 60 * 1000).unref();

// ---------- Eingabe säubern ----------

function str(value, max) {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;
  return s.slice(0, max);
}

function parseIconRef(value) {
  if (typeof value !== "string") return null;
  const icon = value.trim();
  return ICON_REF_RE.test(icon) ? icon : null;
}

function compactTree(documentObj) {
  if (!documentObj || typeof documentObj !== "object" || !documentObj.nodes || typeof documentObj.nodes !== "object") {
    return null;
  }
  const out = [];
  for (const node of Object.values(documentObj.nodes)) {
    if (!node || typeof node.id !== "string") continue;
    const row = {
      id: node.id.slice(0, 24),
      parentId: typeof node.parentId === "string" ? node.parentId.slice(0, 24) : null,
      text: String(node.text || "").slice(0, NODE_TEXT_MAX),
      order: Number.isFinite(node.order) ? node.order : null,
      color: typeof node.color === "string" && NODE_COLORS.has(node.color) ? node.color : undefined,
      dir: ["n", "e", "s", "w"].includes(node.dir) ? node.dir : undefined,
    };
    const icon = parseIconRef(node.icon);
    if (icon) row.icon = icon;
    out.push(row);
    if (out.length >= MAX_TREE_NODES) break;
  }
  if (out.length === 0 || !out.some((n) => n.id === "root")) return null;
  return out;
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-MAX_HISTORY_ITEMS)
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const role = item.role === "assistant" ? "assistant" : "user";
      const content = str(item.content, MAX_INSTRUCTION_CHARS);
      return content ? { role, content } : null;
    })
    .filter(Boolean);
}

// ---------- Galerie: Dokument säubern (fürs Veröffentlichen) ----------

function sanitizeDocument(input) {
  if (!input || typeof input !== "object" || !input.nodes || typeof input.nodes !== "object") return null;
  if (!input.nodes.root || typeof input.nodes.root !== "object") return null;
  const nodes = {};
  let count = 0;
  for (const node of Object.values(input.nodes)) {
    if (!node || typeof node !== "object") continue;
    const id = typeof node.id === "string" ? node.id.slice(0, 24) : null;
    if (!id) continue;
    const clean = {
      id,
      parentId: typeof node.parentId === "string" ? node.parentId.slice(0, 24) : null,
      text: String(node.text || "…").slice(0, NODE_TEXT_MAX),
    };
    if (node.parentId && !clean.parentId) clean.parentId = null;
    for (const field of ["x", "y", "w", "h", "order"]) {
      if (Number.isFinite(node[field])) clean[field] = Math.max(-1e6, Math.min(1e6, node[field]));
    }
    if (["n", "e", "s", "w"].includes(node.dir)) clean.dir = node.dir;
    if (NODE_COLORS.has(node.color)) clean.color = node.color;
    if (["horizontal", "vertical", "around", "radial"].includes(node.flow)) clean.flow = node.flow;
    if (["round", "rect", "pill", "ellipse", "diamond"].includes(node.shape)) clean.shape = node.shape;
    if (["solid", "dashed", "dotted", "dashdot"].includes(node.dash)) clean.dash = node.dash;
    const icon = parseIconRef(node.icon);
    if (icon) clean.icon = icon;
    nodes[id] = clean;
    if (++count >= MAX_TREE_NODES) break;
  }
  if (!nodes.root) return null;
  for (const node of Object.values(nodes)) {
    if (node.parentId && !nodes[node.parentId]) return null;
  }
  const style = input.style && typeof input.style === "object" ? input.style : {};
  const cleanStyle = {};
  if (["color", "mono"].includes(style.color)) cleanStyle.color = style.color;
  if (["curve", "straight", "elbow"].includes(style.line)) cleanStyle.line = style.line;
  if (["solid", "dashed", "dotted", "dashdot"].includes(style.dash)) cleanStyle.dash = style.dash;
  if (["round", "rect", "pill", "ellipse", "diamond"].includes(style.shape)) cleanStyle.shape = style.shape;
  if (["mixed", "filled", "outline", "text"].includes(style.nodes)) cleanStyle.nodes = style.nodes;
  if (["horizontal", "vertical", "around", "radial", "mixed"].includes(style.layout)) cleanStyle.layout = style.layout;
  return {
    version: 1,
    style: cleanStyle,
    camera: { panX: 0, panY: 0, zoom: 1 },
    nodes,
  };
}

// ---------- Galerie: Speicher ----------

function mapPath(id) {
  return join(DATA_DIR, `${id}.json`);
}

async function saveMapEntry(entry) {
  await writeFile(mapPath(entry.id), JSON.stringify(entry, null, 1), "utf8");
}

async function loadMapEntry(id) {
  if (!MAP_ID_RE.test(id)) return null;
  let raw;
  try {
    raw = await readFile(mapPath(id), "utf8");
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function listMapEntries() {
  let files = [];
  try {
    files = await readdir(DATA_DIR);
  } catch {
    return [];
  }
  const entries = [];
  for (const file of files.slice(0, MAX_GALLERY_LIST * 2)) {
    if (!file.endsWith(".json")) continue;
    const entry = await loadMapEntry(file.slice(0, -5));
    if (entry && entry.id && entry.document && entry.document.nodes && entry.document.nodes.root) {
      entries.push(entry);
    }
    if (entries.length >= MAX_GALLERY_LIST) break;
  }
  entries.sort((a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")));
  return entries;
}

function entryMeta(entry) {
  return {
    id: entry.id,
    title: entry.title,
    nodeCount: Object.keys(entry.document.nodes || {}).length,
    publishedAt: entry.publishedAt,
  };
}

// ---------- Galerie: Seed (Pflanzenschutz aus dem Frontend-Tree) ----------

function treeToDocument(tree) {
  const nodes = {};
  let counter = 0;
  const walk = (item, parentId, color, dir, order) => {
    const id = parentId ? `n${++counter}` : "root";
    const text = String(item.text || "…").slice(0, NODE_TEXT_MAX);
    const effectiveDir = item.side === "left" ? "w" : item.side === "right" ? "e" : dir || null;
    nodes[id] = {
      id,
      parentId,
      text,
      x: 0,
      y: 0,
      w: Math.max(40, text.length * 7 + 10),
      h: 18,
      order,
      dir: parentId ? effectiveDir : null,
      color: NODE_COLORS.has(item.color) ? item.color : color,
    };
    const nextColor = NODE_COLORS.has(item.color) ? item.color : color;
    let index = 0;
    for (const child of item.children || []) {
      walk(child, id, nextColor, effectiveDir, index++);
    }
  };
  walk(tree, null, "gold", null, 0);
  return {
    version: 1,
    style: { color: "color", line: "curve", nodes: "mixed", layout: "around" },
    camera: { panX: 0, panY: 0, zoom: 1 },
    nodes,
  };
}

async function seedIfEmpty() {
  const entries = await listMapEntries();
  if (entries.length > 0) return;
  // Container: /app/pflanzenschutz.js (neben server.mjs) — Repo: js/pflanzenschutz.js
  const candidates = [
    new URL("./pflanzenschutz.js", import.meta.url),
    new URL("../js/pflanzenschutz.js", import.meta.url),
  ];
  let src = null;
  for (const url of candidates) {
    try {
      src = await readFile(url, "utf8");
      break;
    } catch {
      /* nächste Kandidatin */
    }
  }
  if (src === null) {
    log("ERROR: pflanzenschutz.js für den Galerie-Seed nicht gefunden");
    return;
  }
  const tree = new Function(`${src}; return PFLANZENSCHUTZ;`)();
  const entry = {
    id: "pflanzenschutz",
    title: "Pflanzenschutz",
    publishedAt: new Date().toISOString(),
    document: treeToDocument(tree),
  };
  await saveMapEntry(entry);
  log("Galerie mit Pflanzenschutz-Karte geseedet");
}

// ---------- OpenRouter ----------

const SYSTEM_PROMPT = `Du bist ein Assistent, der Mindmaps inhaltlich bearbeitet.
Der Nutzer beschreibt Änderungen an seiner Mindmap. Du antwortest IMMER und NUR mit einem einzigen JSON-Objekt, ohne Markdown, ohne Code-Fences, ohne Text außen herum:

{"reply":"<kurze Antwort auf Deutsch, höchstens 2 Sätze>","ops":[ ... ]}

Mögliche Ops (werden in der Reihenfolge ausgeführt):
- {"op":"add","parentId":"<id oder ref>","text":"<Stichwort>","ref":"<kurz, optional>","color":"gold|green|cyan|blue|orange"}
- {"op":"rename","id":"<vorhandene id>","text":"<neuer Text>"}
- {"op":"delete","id":"<vorhandene id, nie root>"}   (löscht nur diesen Knoten; direkte Kinder hängen danach an seinem Elternknoten)
- {"op":"move","id":"<vorhandene id>","newParentId":"<id oder ref>"}
- {"op":"style","style":{"line":"curve|straight|elbow","dash":"solid|dashed|dotted|dashdot","shape":"round|rect|pill|ellipse|diamond","layout":"horizontal|vertical|around|radial",...}} und {"op":"relayout"} nur, wenn der Nutzer ausdrücklich Farbe, Linien, Rahmen, Strich oder Anordnung verlangt. „Links-rechts“ = layout horizontal, „oben-unten“ = vertical, „rundherum“ = around. „Gestrichelt“ = dash dashed.
- {"op":"icon","id":"<vorhandene id oder ref>","icon":"lucide:<name>|auto|null"} Icon setzen. lucide-Namen aus dem Katalog (z. B. leaf, sun, brain, car). "auto" lässt den Server ein passendes Icon wählen/erzeugen. null entfernt das Icon. Nur wenn der Nutzer Icons verlangt.

Regeln für den Baum:
- Neue Knoten bekommen keine echte id. Soll ein neuer Knoten später Eltern sein, setze "ref" (kurz, z. B. "a1"). Kinder nutzen diese ref als parentId. Ein "id" am add ist keine Knoten-Id und zählt nur wie ref. Erfinde keine Ids wie "vincent_handlung". Umhängen nur mit move und einer id aus der Karte.
- Benutze sonst nur ids aus der Karte. "root" ist die Wurzel. delete nie auf "root". Höchstens 50 Ops.
- Hierarchie fachlich korrekt: Teil-von, Schritt-von oder Unterbegriff hängt als Kind, nie als Geschwister. Beispiel falsch: Thylakoide neben Chloroplasten. Richtig: Thylakoide und Stroma unter Chloroplasten. Beispiel falsch: CO₂-Fixierung neben Calvin-Zyklus. Richtig: CO₂-Fixierung unter Calvin-Zyklus.
- Keine Doppelungen: denselben Begriff nicht zweimal (auch nicht unter anderem Namen) auf derselben Ebene oder als parallele Äste.
- Tiefe: die Wurzel zählt nicht. Etwa 5 bis 7 Äste. Nicht alle gleich tief. Mindestens ein Ast reicht bis zur dritten Ebene (Ast → Stichwort → darunter noch ein Stichwort). Mindestens zwei Äste hören bei den direkten Stichworten auf, ohne weitere Stufe. Eine vierte Ebene nur selten und nur an einer Stelle. Nie tiefer als vier. Lieber wenige tiefe Stellen als überall dieselbe Tiefe.
- Stichworte, ein bis vier Wörter. Dieselbe Ebene gleichartig (lauter Nomen oder lauter Fragen, nicht gemischt). Keine Sätze, keine Nummerierung, kein Ast "Sonstiges". Äste decken das Thema ab und wiederholen sich nicht. Fachlich korrekt und gängig benannt.
- Sprache der Knotentexte = Sprache des Nutzerauftrags. Deutscher Auftrag → alle Stichworte auf Deutsch (auch unter englischen Fachbegriffen wie „Cradle to Cradle“: Kinder und Geschwister deutsch, z. B. „Reduzieren“, „Wiederverwenden“, „biologische Kreisläufe“, nicht „Reduce“/„Biological Cycles“). Nur etablierte Eigennamen/Akronyme unverändert lassen.
- Neue thematische Karte (Wurzel war "Neues Thema"/leer oder Auftrag „erstelle Mindmap zu …“): Hauptäste unter root mit unterschiedlichen colors (gold, green, cyan, blue, orange abwechselnd). Kinder erben die Farbe; color nur an Hauptästen setzen.
- Wurzel ist das Thema in zwei, drei Wörtern. Heißt sie "Neues Thema" oder "Neu", umbenennen. Kinder, die nur "Neu" heißen, löschen oder umbenennen, nicht weitere "Neu" daneben stellen.
- Echte vorhandene Inhalte ergänzen, nicht die ganze Karte leeren. „Tiefer“ oder „erweitere“ hängt nur an zwei oder drei bestehenden Ästen je eine weitere Ebene an, etwa 6 bis 12 neue Stichworte. Der Rest bleibt stehen. Bestehende flache Stichworte nicht durch parallele Überbegriffe verdoppeln — lieber darunter hängen oder umbenennen.
- „Entferne“ löscht die genannten Knoten mit delete und der id aus der Liste. Nicht nur im reply behaupten.
- Rückgängig gibt es nicht. Wünsche danach als delete, rename oder move ausführen. Nie „wiederhergestellt“ schreiben, wenn ops leer ist.
- Unklares Thema: keine Ops, eine kurze Rückfrage im reply.
- style und relayout weglassen, außer der Nutzer verlangt ausdrücklich Layout oder Farbe. Node-color an Hauptästen bei neuer Karte ist erlaubt und erwünscht.
- Icons nur auf ausdrücklichen Wunsch. Bevorzugt lucide:<name> aus bekannten Lucide-Namen; bei unsicherem Motiv "auto". Nicht bei jeder neuen Karte automatisch Icons setzen.
- Im reply knapp sagen, was du geändert hast.

Beispiel. Karte: [{"id":"root","parentId":null,"text":"Neues Thema"}]. Auftrag: Mindmap zu Klimaschutz.
{"reply":"Klimaschutz steht jetzt im Zentrum, mit fünf Ästen. Energie geht eine Stufe tiefer.","ops":[
  {"op":"rename","id":"root","text":"Klimaschutz"},
  {"op":"add","parentId":"root","text":"Energie","ref":"a1","color":"gold"},
  {"op":"add","parentId":"a1","text":"Strom","ref":"a1s"},
  {"op":"add","parentId":"a1s","text":"Solar"},
  {"op":"add","parentId":"a1s","text":"Wind"},
  {"op":"add","parentId":"a1","text":"Wärme"},
  {"op":"add","parentId":"root","text":"Verkehr","ref":"a2","color":"green"},
  {"op":"add","parentId":"a2","text":"Bahn"},
  {"op":"add","parentId":"a2","text":"Fahrrad"},
  {"op":"add","parentId":"root","text":"Gebäude","ref":"a3","color":"cyan"},
  {"op":"add","parentId":"a3","text":"Dämmung"},
  {"op":"add","parentId":"root","text":"Konsum","ref":"a4","color":"blue"},
  {"op":"add","parentId":"a4","text":"Ernährung"},
  {"op":"add","parentId":"root","text":"Politik","ref":"a5","color":"orange"},
  {"op":"add","parentId":"a5","text":"CO2-Preis"}
]}
Verkehr, Gebäude, Konsum und Politik bleiben flach. Nur Energie geht über Strom zu Solar und Wind.`;

const REVIEW_PROMPT = `Du bist Qualitätskontrolle für Mindmaps. Der Nutzer hat gerade eine Änderung erhalten; die aktuelle Karte liegt vor. Prüfe fachliche Korrektheit, Hierarchie und Doppelungen.

Antworte IMMER und NUR mit einem JSON-Objekt, ohne Markdown:

{"reply":"<ein Satz Bewertung auf Deutsch>","needsCorrection":true|false,"reason":"<kurz, warum Korrektur sinnvoll wäre; leer wenn false>","ops":[ ... ]}

Ops wie beim Bearbeiten: add, rename, delete, move. Kein style/relayout in der Kontrolle.
- needsCorrection nur true bei echten Fehlern: falsche Fakten, Teil-von als Geschwister, doppelte/redundante Stichworte, fehlender Kernbegriff zum Auftrag, Wurzel noch "Neues Thema", falsche Sprache (deutscher Auftrag, aber englische Stichworte statt üblicher deutscher Begriffe — mit rename korrigieren; Eigennamen wie „Cradle to Cradle“ dürfen bleiben).
- Bei true MUSS ops mindestens eine Korrektur enthalten. Nur beschreiben ohne Ops ist verboten. Nutze vorhandene ids aus der Karte (move/rename/delete bevorzugt, add nur wenn nötig). Höchstens 20 Ops. Keine komplette Neuerstellung.
- Bei false: ops []. reason "".
- Nicht überfein korrigieren. Geschmack oder „noch mehr Details“ allein reicht nicht.
- reply immer setzen. reason ist der Text für die Nachfrage an den Nutzer.

Beispiel. Fehler: Thylakoide und Stroma liegen neben Chloroplasten statt darunter; Calvin-Zyklus und CO2-Fixierung liegen neben Dunkelreaktion.
{"reply":"Hierarchie der Orte und der Dunkelreaktion war falsch; Korrektur vorgeschlagen.","needsCorrection":true,"reason":"Thylakoide und Stroma gehören unter Chloroplasten; Calvin-Zyklus unter Dunkelreaktion; CO₂-Fixierung unter den Calvin-Zyklus.","ops":[
  {"op":"move","id":"c","newParentId":"b"},
  {"op":"move","id":"d","newParentId":"b"},
  {"op":"move","id":"g","newParentId":"f"},
  {"op":"move","id":"h","newParentId":"g"}
]}`;

function buildMessages(tree, instruction, history, mode = "edit") {
  const system = mode === "review" ? REVIEW_PROMPT : SYSTEM_PROMPT;
  const messages = [{ role: "system", content: system }];
  if (mode !== "review") {
    for (const item of history) messages.push({ role: item.role, content: item.content });
  }
  const task =
    mode === "review"
      ? `Ursprünglicher Auftrag: ${instruction}\n\nAktuelle Karte (Knoten als JSON-Liste):\n${JSON.stringify(tree)}\n\nPrüfe die Karte und korrigiere nur echte Probleme.`
      : `Karte (Knoten als JSON-Liste):\n${JSON.stringify(tree)}\n\nAuftrag: ${instruction}`;
  messages.push({ role: "user", content: task });
  return messages;
}

async function callOpenRouter(model, messages, clientAbort) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
  if (clientAbort) {
    if (clientAbort.aborted) controller.abort();
    else clientAbort.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://mindmap.orga-hero.com",
        "X-Title": "Mindmap",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0.2,
        response_format: { type: "json_object" },
        reasoning: { enabled: false },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const status = res.status === 401 || res.status === 403 ? 502 : res.status === 429 ? 429 : 502;
      const err = new Error(`openrouter ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
      err.status = status;
      throw err;
    }
    const data = await res.json();
    const message = data?.choices?.[0]?.message || {};
    const content = messageText(message.content);
    const reasoning = messageText(message.reasoning);
    if (!content && !reasoning) throw new Error("openrouter: leere Antwort");
    return {
      content,
      reasoning,
      finish: data?.choices?.[0]?.finish_reason || "",
      model: data.model || model,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Antwort parsen/säubern ----------

function messageText(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((part) => (typeof part === "string" ? part : part && typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }
  return "";
}

function parseJsonObject(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function extractJson(content) {
  if (typeof content !== "string" || !content.trim()) return null;
  let text = content.trim().replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) text = fence[1].trim();
  const parsed = parseJsonObject(text);
  if (parsed && typeof parsed === "object") return parsed;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function extractReply(content, reasoning) {
  const fromContent = extractJson(content);
  if (fromContent && (Array.isArray(fromContent.ops) || typeof fromContent.reply === "string")) return fromContent;
  const fromReasoning = extractJson(reasoning);
  if (fromReasoning && (Array.isArray(fromReasoning.ops) || typeof fromReasoning.reply === "string")) return fromReasoning;
  return fromContent || fromReasoning;
}

const REF_RE = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

function addAlias(raw, knownIds) {
  const candidates = [str(raw.ref, 32), str(raw.id, 32)];
  for (const alias of candidates) {
    if (!alias || alias === "root" || knownIds.has(alias) || !REF_RE.test(alias)) continue;
    return alias;
  }
  return null;
}

function sanitizeOps(rawOps, knownIds = new Set()) {
  if (!Array.isArray(rawOps)) return [];
  const seenIds = new Set();
  const ops = [];
  for (const raw of rawOps.slice(0, 50)) {
    if (!raw || typeof raw !== "object") continue;
    const op = raw.op;
    if (op === "add") {
      const parentId = str(raw.parentId, 32);
      const text = str(raw.text, NODE_TEXT_MAX);
      if (!parentId || !text) continue;
      const out = { op: "add", parentId, text };
      const ref = addAlias(raw, knownIds);
      if (ref && !seenIds.has(`ref:${ref}`)) {
        seenIds.add(`ref:${ref}`);
        out.ref = ref;
      }
      if (typeof raw.color === "string" && NODE_COLORS.has(raw.color) && raw.color !== "root") out.color = raw.color;
      ops.push(out);
    } else if (op === "rename") {
      const id = str(raw.id, 32);
      const text = str(raw.text, NODE_TEXT_MAX);
      if (id && text) ops.push({ op: "rename", id, text });
    } else if (op === "delete") {
      const id = str(raw.id, 32);
      if (id && id !== "root") ops.push({ op: "delete", id });
    } else if (op === "move") {
      const id = str(raw.id, 32);
      const newParentId = str(raw.newParentId, 32);
      if (id && newParentId && id !== "root" && id !== newParentId) ops.push({ op: "move", id, newParentId });
    } else if (op === "style") {
      const style = raw.style && typeof raw.style === "object" ? raw.style : raw;
      const allowed = {};
      if (["color", "mono"].includes(style.color)) allowed.color = style.color;
      if (["curve", "straight", "elbow"].includes(style.line)) allowed.line = style.line;
      if (["solid", "dashed", "dotted", "dashdot"].includes(style.dash)) allowed.dash = style.dash;
      if (["round", "rect", "pill", "ellipse", "diamond"].includes(style.shape)) allowed.shape = style.shape;
      if (["mixed", "filled", "outline", "text"].includes(style.nodes)) allowed.nodes = style.nodes;
      if (["horizontal", "vertical", "around", "radial", "mixed"].includes(style.layout)) allowed.layout = style.layout;
      if (Object.keys(allowed).length > 0) ops.push({ op: "style", style: allowed });
    } else if (op === "icon") {
      const id = str(raw.id, 32);
      if (!id) continue;
      if (raw.icon === null || raw.icon === "") {
        ops.push({ op: "icon", id, icon: null });
        continue;
      }
      if (raw.icon === "auto") {
        ops.push({ op: "icon", id, icon: "auto" });
        continue;
      }
      const icon = parseIconRef(raw.icon);
      if (icon) ops.push({ op: "icon", id, icon });
    } else if (op === "relayout") {
      if (!seenIds.has("relayout")) {
        seenIds.add("relayout");
        ops.push({ op: "relayout" });
      }
    }
  }
  return ops;
}

function sanitizeReply(reply) {
  const text = str(reply, MAX_REPLY_CHARS);
  return text || "Antwort vom Modell konnte nicht gelesen werden.";
}

// ---------- Handler: Chat ----------

async function handleChat(req, res) {
  const ip = clientIp(req);
  const authed = verifyBasicAuth(req.headers.authorization);
  const tier = authed ? "auth" : "anon";
  const model = authed ? MODEL_AUTH : MODEL_PUBLIC;
  const ok = rateOk(`${tier}:${ip}`, authed ? RATE_AUTH_MAX : RATE_ANON_MAX, authed ? RATE_AUTH_WINDOW_MS : RATE_ANON_WINDOW_MS);
  if (!ok) {
    sendJson(res, 429, { error: "Too many requests", retryAfterSeconds: authed ? 60 : 300 });
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: "Ungültiger Request-Body (JSON erwartet)" });
    return;
  }

  const tree = compactTree(parsed.document);
  const instruction = str(parsed.instruction, MAX_INSTRUCTION_CHARS);
  if (!tree || !instruction) {
    sendJson(res, 400, { error: "document (mit nodes.root) und instruction werden benötigt" });
    return;
  }
  const history = sanitizeHistory(parsed.history);
  const mode = parsed.mode === "review" ? "review" : "edit";

  if (!OPENROUTER_API_KEY) {
    sendJson(res, 503, { error: "API-Key nicht konfiguriert", hint: "OPENROUTER_API_KEY in der Server-.env fehlt." });
    return;
  }

  const clientAbort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) clientAbort.abort();
  });

  try {
    holdOpen(res);
    const { content, reasoning, finish, model: usedModel } = await callOpenRouter(
      model,
      buildMessages(tree, instruction, history, mode),
      clientAbort.signal,
    );
    const json = extractReply(content, reasoning);
    let ops = sanitizeOps(json?.ops, new Set(tree.map((node) => node.id)));
    if (mode === "review") {
      ops = ops.filter((op) => op.op !== "style" && op.op !== "relayout" && op.op !== "icon").slice(0, 20);
    }
    let reply = str(json?.reply, MAX_REPLY_CHARS);
    if (!reply && ops.length) reply = mode === "review" ? "Korrektur vorgeschlagen." : "Die Karte ist angepasst.";
    if (!reply) {
      const snippet = (content || reasoning || "").replace(/\s+/g, " ").slice(0, 160);
      log("UNPARSED", finish || "?", `content=${content.length}`, `reasoning=${reasoning.length}`, snippet);
      reply = "Antwort vom Modell konnte nicht gelesen werden.";
    }
    const needsCorrection = mode === "review" && ops.length > 0 && json?.needsCorrection !== false;
    const reason = mode === "review" ? str(json?.reason, MAX_REPLY_CHARS) || (needsCorrection ? reply : "") : "";
    log(ip, tier, usedModel, mode, `ops=${ops.length}`, needsCorrection ? "fix" : "", finish || "");
    sendJson(res, 200, {
      reply,
      ops,
      model: usedModel,
      authed,
      mode,
      needsCorrection: Boolean(needsCorrection),
      reason,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      if (clientAbort.signal.aborted || res.writableEnded) {
        log("CLIENT_GONE", model);
        if (!res.writableEnded) {
          try {
            res.end();
          } catch {
            /* Verbindung ist schon zu. */
          }
        }
        return;
      }
      log("TIMEOUT", model);
      const minutes = OPENROUTER_TIMEOUT_MS / 60000;
      sendJson(res, 504, {
        error: `Das Modell hat länger als ${minutes} Minuten gebraucht. Bitte nochmal versuchen.`,
      });
    } else {
      log("ERROR", err.message);
      const status = err.status || 502;
      const friendly =
        status === 429
          ? "Rate-Limit beim Modellanbieter erreicht. Bitte gleich nochmal versuchen."
          : "Fehler beim Aufruf des Modellanbieters. Bitte gleich nochmal versuchen.";
      sendJson(res, status, { error: friendly, detail: err.message.slice(0, 200) });
    }
  }
}

// ---------- Handler: Galerie ----------

async function handleListMaps(res) {
  const entries = await listMapEntries();
  sendJson(res, 200, { maps: entries.map(entryMeta) });
}

async function handleGetMap(res, id) {
  const entry = await loadMapEntry(id);
  if (!entry) {
    sendJson(res, 404, { error: "Karte nicht gefunden" });
    return;
  }
  sendJson(res, 200, { ...entryMeta(entry), document: entry.document });
}

async function handlePublish(req, res) {
  const ip = clientIp(req);
  if (!rateOk(`publish:${ip}`, PUBLISH_MAX_PER_DAY, PUBLISH_WINDOW_MS)) {
    sendJson(res, 429, { error: `Veröffentlichungs-Limit erreicht (${PUBLISH_MAX_PER_DAY} pro Tag und IP).` });
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: "Ungültiger Request-Body (JSON erwartet)" });
    return;
  }

  const document = sanitizeDocument(parsed.document);
  if (!document) {
    sendJson(res, 400, { error: "Ungültiges Dokument (nodes.root und gültige parentId-Verweise werden benötigt)" });
    return;
  }

  const title = str(parsed.title, MAX_TITLE_CHARS) || str(document.nodes.root.text, MAX_TITLE_CHARS) || "Mindmap";

  let id = null;
  for (let attempt = 0; attempt < 5 && !id; attempt++) {
    const candidate = crypto.randomBytes(4).toString("hex");
    if (!(await loadMapEntry(candidate))) id = candidate;
  }
  if (!id) {
    sendJson(res, 500, { error: "Konnte keine freie Karten-Id erzeugen" });
    return;
  }

  const entry = { id, title, publishedAt: new Date().toISOString(), document };
  await saveMapEntry(entry);
  log(ip, "publish", id, `nodes=${Object.keys(document.nodes).length}`);
  sendJson(res, 201, { id, title, nodeCount: Object.keys(document.nodes).length });
}

// ---------- Icons: Katalog + generierter Pool ----------

let lucideCatalog = [];
let generatedIndex = [];

function iconIndexPath() {
  return join(ICONS_DIR, "index.json");
}

function genIconPath(id) {
  return join(ICONS_DIR, `${id}.png`);
}

async function loadLucideCatalog() {
  try {
    const raw = await readFile(ICONS_CATALOG, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === "string")
      .map((item) => ({
        id: String(item.id).slice(0, 64),
        kind: "lucide",
        label: String(item.label || item.id).slice(0, 80),
        tags: Array.isArray(item.tags) ? item.tags.map((t) => String(t).slice(0, 40)).slice(0, 12) : [],
        url: `/icons/lucide/${String(item.id).slice(0, 64)}.svg`,
      }));
  } catch (err) {
    log("WARN icons catalog:", err.message);
    return [];
  }
}

async function loadGeneratedIndex() {
  try {
    const raw = await readFile(iconIndexPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === "string" && GEN_ID_RE.test(item.id))
      .map((item) => ({
        id: item.id,
        kind: "gen",
        label: String(item.label || item.id).slice(0, 80),
        tags: Array.isArray(item.tags) ? item.tags.map((t) => String(t).slice(0, 40)).slice(0, 12) : [],
        url: `/api/icons/gen/${item.id}`,
        createdAt: item.createdAt || null,
      }));
  } catch {
    return [];
  }
}

async function saveGeneratedIndex() {
  await mkdir(ICONS_DIR, { recursive: true });
  await writeFile(iconIndexPath(), JSON.stringify(generatedIndex, null, 1), "utf8");
}

function fullIconCatalog() {
  return [...lucideCatalog, ...generatedIndex];
}

function catalogForPrompt(limit = 160) {
  return fullIconCatalog()
    .slice(0, limit)
    .map((item) => ({
      ref: item.kind === "lucide" ? `lucide:${item.id}` : `gen:${item.id}`,
      label: item.label,
      tags: item.tags.slice(0, 6),
    }));
}

async function callOpenRouterImage(prompt, clientAbort, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
  if (clientAbort) {
    if (clientAbort.aborted) controller.abort();
    else clientAbort.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    const body = {
      model: MODEL_IMAGE,
      prompt,
      aspect_ratio: options.aspectRatio || "1:1",
      output_format: options.outputFormat || "png",
    };
    if (Array.isArray(options.inputReferences) && options.inputReferences.length) {
      body.input_references = options.inputReferences.slice(0, 8);
    }
    const res = await fetch("https://openrouter.ai/api/v1/images", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://mindmap.orga-hero.com",
        "X-Title": "Mindmap",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const err = new Error(`openrouter image ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
      err.status = res.status === 429 ? 429 : res.status === 402 ? 402 : 502;
      throw err;
    }
    const data = await res.json();
    const b64 = data?.data?.[0]?.b64_json || data?.images?.[0]?.b64_json;
    if (!b64 || typeof b64 !== "string") throw new Error("openrouter image: leere Antwort");
    return Buffer.from(b64, "base64");
  } finally {
    clearTimeout(timer);
  }
}

function enchantLabel(node) {
  return String((node && node.text) || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function enchantVerbatim(nodes) {
  const labels = [];
  const edges = [];
  const byId = new Map();
  for (const node of nodes) {
    if (!node || typeof node.id !== "string") continue;
    byId.set(node.id, node);
    const text = enchantLabel(node);
    if (text) labels.push(text);
  }
  for (const node of nodes) {
    if (!node || !node.parentId) continue;
    const from = enchantLabel(byId.get(node.parentId));
    const to = enchantLabel(node);
    if (!from || !to) continue;
    edges.push(`${from} -> ${to}`);
  }
  return { labels, edges };
}

function enchantPrompt({ title, labels, edges, background, exact }) {
  const topic = title || "Mindmap";
  if (exact) {
    return [
      `Paint only a calm atmospheric background for a poster about "${topic}".`,
      "No text, no letters, no words, no numbers, no boxes, no nodes, no arrows, no diagrams, no lines, no icons.",
      "Soft low-contrast illustration with an empty center so a diagram can sit on top.",
      "No watermark.",
    ].join("\n\n");
  }
  const bg = background
    ? "Add a tasteful atmospheric background that fits the topic. Keep every label clearly readable; do not bury words in busy areas."
    : "Use a clean plain or softly gradient paper-like background. No scenery, no decorative wallpaper, no photo backdrop.";
  const labelBlock = (labels.length ? labels : [topic]).map((text) => `- ${text}`).join("\n");
  const edgeBlock = (edges.length ? edges : ["(none)"]).map((text) => `- ${text}`).join("\n");
  return [
    "You are redrawing a mind map as a polished graphic poster.",
    "Change the visual craft: node shapes, colors, spacing, alignment, and connector style. Keep the same nodes and the same parent-child links.",
    "A reference image is attached. Copy every label below character for character, including repeated wording. Do not correct spelling, do not translate, do not merge two labels into one, do not invent words.",
    `Labels:\n${labelBlock}`,
    "Connectors: draw exactly one line for each pair below. Do not add a second line between the same two nodes. Do not add any other connection.",
    edgeBlock,
    bg,
    "No watermarks, no UI chrome, no browser window, no toolbars, no cursor.",
    `Central topic: ${topic}.`,
  ].join("\n\n");
}

function parseDataUrlImage(dataUrl) {
  if (typeof dataUrl !== "string" || dataUrl.length > MAX_ENCHANT_IMAGE_CHARS) return null;
  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  const mediaType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const b64 = match[2].replace(/\s+/g, "");
  if (!b64 || b64.length > MAX_ENCHANT_IMAGE_CHARS) return null;
  return { mediaType, dataUrl: `data:${mediaType};base64,${b64}` };
}

function aspectFromSize(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return "16:9";
  const ratio = w / h;
  if (ratio > 1.7) return "16:9";
  if (ratio < 0.6) return "9:16";
  if (ratio > 1.25) return "4:3";
  if (ratio < 0.8) return "3:4";
  return "1:1";
}

async function handleEnchant(req, res) {
  const ip = clientIp(req);
  const authed = verifyBasicAuth(req.headers.authorization);
  const tier = authed ? "auth" : "anon";
  if (!rateOk(`enchant:${tier}:${ip}`, authed ? RATE_ENCHANT_AUTH_MAX : RATE_ENCHANT_ANON_MAX, RATE_ENCHANT_WINDOW_MS)) {
    sendJson(res, 429, {
      error: "Zu viele Illustrationen hintereinander. Bitte ein paar Minuten warten und dann erneut versuchen.",
    });
    return;
  }
  if (!OPENROUTER_API_KEY) {
    sendJson(res, 503, { error: "API-Key nicht konfiguriert" });
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(await readBody(req, MAX_ENCHANT_BODY_BYTES));
  } catch (err) {
    sendJson(res, 400, { error: err.message === "body too large" ? "Bild zu groß (max. ca. 2,5 MB)." : "Ungültiger Request-Body (JSON erwartet)" });
    return;
  }

  const exact = parsed.mode === "exact";
  const image = exact ? null : parseDataUrlImage(parsed.image);
  if (!exact && !image) {
    sendJson(res, 400, { error: "image (data-URL PNG/JPEG/WebP) wird benötigt" });
    return;
  }
  const background = parsed.background !== false;
  const title = str(parsed.title, MAX_TITLE_CHARS) || "Mindmap";
  const tree = exact || !Array.isArray(parsed.tree) ? [] : parsed.tree.slice(0, MAX_ENCHANT_TREE_NODES);
  const { labels, edges } = enchantVerbatim(tree);
  const aspectRatio = aspectFromSize(parsed.width, parsed.height);
  const prompt = enchantPrompt({ title, labels, edges, background, exact });

  const clientAbort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) clientAbort.abort();
  });

  try {
    holdOpen(res);
    const imageOptions = { aspectRatio, outputFormat: "png" };
    if (image) {
      imageOptions.inputReferences = [{ type: "image_url", image_url: { url: image.dataUrl } }];
    }
    const bytes = await callOpenRouterImage(prompt, clientAbort.signal, imageOptions);
    const out = `data:image/png;base64,${bytes.toString("base64")}`;
    const mode = exact ? "exact" : "restyle";
    log(ip, tier, MODEL_IMAGE, "enchant", mode, background ? "bg" : "plain", `bytes=${bytes.length}`);
    sendJson(res, 200, { image: out, model: MODEL_IMAGE, background, mode });
  } catch (err) {
    if (err.name === "AbortError") {
      if (clientAbort.signal.aborted || res.writableEnded) {
        if (!res.writableEnded) {
          try {
            res.end();
          } catch {
            /* closed */
          }
        }
        return;
      }
      sendJson(res, 504, { error: "Verzaubern hat zu lange gebraucht." });
      return;
    }
    log("ERROR enchant", err.message);
    const friendly =
      err.status === 429
        ? "Rate-Limit beim Bildmodell. Bitte später erneut versuchen."
        : err.status === 402 || /402|Insufficient credits|credits/i.test(err.message)
          ? "Image-Gen: OpenRouter-Guthaben fehlt oder ist aufgebraucht."
          : "Verzaubern fehlgeschlagen. Bitte gleich nochmal versuchen.";
    sendJson(res, err.status === 402 ? 402 : err.status || 502, {
      error: friendly,
      detail: err.message.slice(0, 200),
    });
  }
}

async function generateAndStoreIcon(label, tags, clientAbort) {
  const id = crypto.randomBytes(6).toString("hex");
  const prompt = [
    "Simple flat vector-style app icon for a mind map node.",
    `Subject: ${label}.`,
    "Single centered symbol, minimal detail, clean silhouette,",
    "soft solid colors, no text, no watermark, square composition, plain light background.",
  ].join(" ");
  const bytes = await callOpenRouterImage(prompt, clientAbort);
  await mkdir(ICONS_DIR, { recursive: true });
  await writeFile(genIconPath(id), bytes);
  const entry = {
    id,
    kind: "gen",
    label: String(label).slice(0, 80),
    tags: (tags || []).map((t) => String(t).slice(0, 40)).slice(0, 12),
    url: `/api/icons/gen/${id}`,
    createdAt: new Date().toISOString(),
  };
  generatedIndex = [entry, ...generatedIndex.filter((item) => item.id !== id)].slice(0, 2000);
  await saveGeneratedIndex();
  return entry;
}

async function chooseIconsWithModel(targets, catalog, model, clientAbort) {
  const messages = [
    {
      role: "system",
      content: `Du wählst Icons für Mindmap-Knoten. Antworte NUR mit JSON:
{"picks":[{"id":"<knoten-id>","icon":"lucide:name|gen:id|none"}]}
Regeln: Pro Knoten genau ein Eintrag. icon muss aus dem Katalog kommen oder "none". Kein Text außerhalb JSON.`,
    },
    {
      role: "user",
      content: `Knoten:\n${JSON.stringify(targets)}\n\nKatalog:\n${JSON.stringify(catalog)}`,
    },
  ];
  const { content, reasoning } = await callOpenRouter(model, messages, clientAbort);
  const json = extractJson(content) || extractJson(reasoning) || {};
  const picks = Array.isArray(json.picks) ? json.picks : [];
  const byId = new Map();
  for (const pick of picks) {
    if (!pick || typeof pick.id !== "string") continue;
    const icon = pick.icon === "none" || pick.icon === null ? "none" : parseIconRef(pick.icon);
    if (!icon) continue;
    byId.set(pick.id.slice(0, 32), icon);
  }
  return byId;
}

function handleListIcons(res) {
  sendJson(res, 200, { icons: fullIconCatalog() });
}

async function handleGetGenIcon(res, id) {
  if (!GEN_ID_RE.test(id)) {
    sendJson(res, 404, { error: "Icon nicht gefunden" });
    return;
  }
  try {
    const bytes = await readFile(genIconPath(id));
    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": bytes.length,
      "Cache-Control": "public, max-age=86400",
    });
    res.end(bytes);
  } catch {
    sendJson(res, 404, { error: "Icon nicht gefunden" });
  }
}

function parsePngDataUrl(value) {
  if (typeof value !== "string") return null;
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/i.exec(value.trim());
  if (!match) return null;
  let bytes;
  try {
    bytes = Buffer.from(match[1], "base64");
  } catch {
    return null;
  }
  if (!bytes.length || bytes.length > MAX_ICON_UPLOAD_BYTES) return null;
  // PNG-Signatur
  if (
    bytes.length < 8 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    return null;
  }
  return bytes;
}

async function storeUploadedIcon(label, bytes) {
  const id = crypto.randomBytes(6).toString("hex");
  await mkdir(ICONS_DIR, { recursive: true });
  await writeFile(genIconPath(id), bytes);
  const entry = {
    id,
    kind: "gen",
    label: String(label || "Upload").slice(0, 80),
    tags: ["upload"],
    url: `/api/icons/gen/${id}`,
    createdAt: new Date().toISOString(),
  };
  generatedIndex = [entry, ...generatedIndex.filter((item) => item.id !== id)].slice(0, 2000);
  await saveGeneratedIndex();
  return entry;
}

async function handleUploadIcon(req, res) {
  const ip = clientIp(req);
  const authed = verifyBasicAuth(req.headers.authorization);
  const tier = authed ? "auth" : "anon";
  if (!rateOk(`icon-upload:${tier}:${ip}`, authed ? RATE_ICON_UPLOAD_AUTH_MAX : RATE_ICON_UPLOAD_ANON_MAX, RATE_ANON_WINDOW_MS)) {
    sendJson(res, 429, { error: "Too many requests", retryAfterSeconds: 300 });
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(await readBody(req, MAX_ICON_UPLOAD_BODY_BYTES));
  } catch (err) {
    sendJson(res, err && /too large/i.test(err.message) ? 413 : 400, {
      error: err && /too large/i.test(err.message) ? "Bild zu groß" : "Ungültiger Request-Body (JSON erwartet)",
    });
    return;
  }
  const bytes = parsePngDataUrl(parsed && parsed.image);
  if (!bytes) {
    sendJson(res, 400, {
      error: "image muss eine PNG-data-URL sein (max. 400 KB)",
    });
    return;
  }
  const label =
    parsed && typeof parsed.label === "string" && parsed.label.trim()
      ? parsed.label.trim().slice(0, 80)
      : "Upload";
  try {
    const entry = await storeUploadedIcon(label, bytes);
    log(ip, tier, "icons-upload", entry.id, `bytes=${bytes.length}`);
    sendJson(res, 200, { icon: `gen:${entry.id}`, entry });
  } catch (err) {
    log("ERROR icons-upload", err.message);
    sendJson(res, err.status || 500, { error: err.message || "Upload fehlgeschlagen" });
  }
}

async function handleAssignIcons(req, res) {
  const ip = clientIp(req);
  const authed = verifyBasicAuth(req.headers.authorization);
  const tier = authed ? "auth" : "anon";
  const model = authed ? MODEL_AUTH : MODEL_PUBLIC;
  if (!rateOk(`icons:${tier}:${ip}`, authed ? RATE_ICON_AUTH_MAX : RATE_ICON_ANON_MAX, RATE_ANON_WINDOW_MS)) {
    sendJson(res, 429, { error: "Too many requests", retryAfterSeconds: 300 });
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: "Ungültiger Request-Body (JSON erwartet)" });
    return;
  }
  const targets = Array.isArray(parsed.targets)
    ? parsed.targets
        .filter((t) => t && typeof t.id === "string" && typeof t.text === "string")
        .map((t) => ({ id: t.id.slice(0, 32), text: String(t.text).slice(0, NODE_TEXT_MAX) }))
        .slice(0, MAX_ASSIGN_TARGETS)
    : [];
  if (!targets.length) {
    sendJson(res, 400, { error: "targets ([{id,text}, …]) werden benötigt" });
    return;
  }
  if (!OPENROUTER_API_KEY) {
    sendJson(res, 503, { error: "API-Key nicht konfiguriert" });
    return;
  }
  const allowGenerate = parsed.allowGenerate !== false;
  const clientAbort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) clientAbort.abort();
  });

  try {
    holdOpen(res);
    const catalog = catalogForPrompt();
    const picks = await chooseIconsWithModel(targets, catalog, model, clientAbort.signal);
    const assignments = [];
    const created = [];
    const warnings = [];
    let generated = 0;
    for (const target of targets) {
      let icon = picks.get(target.id) || "none";
      if (icon !== "none" && !fullIconCatalog().some((item) => {
        const ref = item.kind === "lucide" ? `lucide:${item.id}` : `gen:${item.id}`;
        return ref === icon;
      })) {
        icon = "none";
      }
      if (icon === "none" && allowGenerate && generated < MAX_GENERATE_PER_ASSIGN) {
        try {
          const entry = await generateAndStoreIcon(target.text, [target.text.toLowerCase()], clientAbort.signal);
          icon = `gen:${entry.id}`;
          created.push(entry);
          generated += 1;
        } catch (err) {
          if (err.name === "AbortError") throw err;
          log("ICON_GEN_FAIL", target.id, err.message);
          if (/402|Insufficient credits|credits/i.test(err.message)) {
            warnings.push("Image-Gen: OpenRouter-Guthaben fehlt oder ist aufgebraucht.");
          } else {
            warnings.push(`Image-Gen fehlgeschlagen (${target.text}).`);
          }
          icon = null;
        }
      } else if (icon === "none") {
        icon = null;
      }
      if (icon) assignments.push({ id: target.id, icon });
    }
    log(ip, tier, model, "icons-assign", `n=${assignments.length}`, `gen=${created.length}`);
    sendJson(res, 200, {
      assignments,
      created,
      model,
      warnings: [...new Set(warnings)].slice(0, 3),
    });
  } catch (err) {
    if (err.name === "AbortError") {
      if (clientAbort.signal.aborted || res.writableEnded) {
        if (!res.writableEnded) {
          try {
            res.end();
          } catch {
            /* already closed */
          }
        }
        return;
      }
      sendJson(res, 504, { error: "Icon-Auswahl hat zu lange gebraucht." });
      return;
    }
    log("ERROR icons-assign", err.message);
    sendJson(res, err.status || 502, {
      error: err.status === 429 ? "Rate-Limit beim Modellanbieter." : "Icon-Zuweisung fehlgeschlagen.",
      detail: err.message.slice(0, 200),
    });
  }
}

// ---------- Server ----------

const server = http.createServer((req, res) => {
  const url = (req.url || "").split("?")[0].replace(/\/+$/, "") || "/";

  if (req.method === "GET" && (url === "/api/health" || url === "/health")) {
    sendJson(res, 200, {
      ok: true,
      modelPublic: MODEL_PUBLIC,
      modelAuth: MODEL_AUTH,
      modelImage: MODEL_IMAGE,
      keyConfigured: Boolean(OPENROUTER_API_KEY),
      authConfigured: Boolean(AUTH_USER && AUTH_HASH),
      iconsLucide: lucideCatalog.length,
      iconsGenerated: generatedIndex.length,
    });
    return;
  }
  if (req.method === "POST" && url === "/api/chat") {
    handleChat(req, res).catch((err) => {
      log("FATAL", err);
      if (!res.headersSent) sendJson(res, 500, { error: "Interner Fehler" });
    });
    return;
  }
  if (req.method === "GET" && url === "/api/icons") {
    handleListIcons(res);
    return;
  }
  if (req.method === "POST" && url === "/api/icons/assign") {
    handleAssignIcons(req, res).catch((err) => {
      log("FATAL", err);
      if (!res.headersSent) sendJson(res, 500, { error: "Interner Fehler" });
    });
    return;
  }
  if (req.method === "POST" && url === "/api/icons/upload") {
    handleUploadIcon(req, res).catch((err) => {
      log("FATAL", err);
      if (!res.headersSent) sendJson(res, 500, { error: "Interner Fehler" });
    });
    return;
  }
  if (req.method === "POST" && url === "/api/enchant") {
    handleEnchant(req, res).catch((err) => {
      log("FATAL", err);
      if (!res.headersSent) sendJson(res, 500, { error: "Interner Fehler" });
    });
    return;
  }
  const genIconMatch = /^\/api\/icons\/gen\/([a-z0-9]{8,24})$/.exec(url);
  if (req.method === "GET" && genIconMatch) {
    handleGetGenIcon(res, genIconMatch[1]).catch((err) => {
      log("FATAL", err);
      if (!res.headersSent) sendJson(res, 500, { error: "Interner Fehler" });
    });
    return;
  }
  if (req.method === "GET" && url === "/api/maps") {
    handleListMaps(res).catch((err) => {
      log("FATAL", err);
      if (!res.headersSent) sendJson(res, 500, { error: "Interner Fehler" });
    });
    return;
  }
  if (req.method === "POST" && url === "/api/maps") {
    handlePublish(req, res).catch((err) => {
      log("FATAL", err);
      if (!res.headersSent) sendJson(res, 500, { error: "Interner Fehler" });
    });
    return;
  }
  const mapMatch = /^\/api\/maps\/([a-z0-9-]{1,24})$/.exec(url);
  if (req.method === "GET" && mapMatch) {
    handleGetMap(res, mapMatch[1]).catch((err) => {
      log("FATAL", err);
      if (!res.headersSent) sendJson(res, 500, { error: "Interner Fehler" });
    });
    return;
  }
  sendJson(res, 404, { error: "Not Found" });
});

Promise.all([
  mkdir(DATA_DIR, { recursive: true }).then(() => seedIfEmpty()),
  mkdir(ICONS_DIR, { recursive: true })
    .then(() => loadLucideCatalog())
    .then((list) => {
      lucideCatalog = list;
      return loadGeneratedIndex();
    })
    .then((list) => {
      generatedIndex = list;
    }),
])
  .catch((err) => log("ERROR beim Start:", err.message))
  .finally(() => {
    server.listen(PORT, () => {
      log(
        `listening on :${PORT}`,
        `keyConfigured=${Boolean(OPENROUTER_API_KEY)}`,
        `authConfigured=${Boolean(AUTH_USER && AUTH_HASH)}`,
        `dataDir=${DATA_DIR}`,
        `iconsDir=${ICONS_DIR}`,
        `lucide=${lucideCatalog.length}`,
        `generated=${generatedIndex.length}`,
        `imageModel=${MODEL_IMAGE}`,
      );
    });
  });
