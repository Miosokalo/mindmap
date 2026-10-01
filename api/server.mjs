/**
 * Mindmap-API (Zero-Dependency, node:http).
 *
 * Chat:
 *   POST /api/chat  { document, instruction, history? } -> { reply, ops, model, authed }
 *   GET  /api/health -> { ok, modelPublic, modelAuth, keyConfigured }
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
const MODEL_PUBLIC = (process.env.OPENROUTER_MODEL_PUBLIC || "deepseek/deepseek-chat-v3.1:free").trim();
const MODEL_AUTH = (process.env.OPENROUTER_MODEL_AUTH || "anthropic/claude-sonnet-4.5").trim();
const AUTH_USER = (process.env.MINDMAP_CHAT_AUTH_USER || "").trim();
const AUTH_HASH = (process.env.MINDMAP_CHAT_AUTH_HASH || "").trim();
const DATA_DIR = (process.env.DATA_DIR || "/data/maps").trim();

const RATE_ANON_MAX = 10;
const RATE_ANON_WINDOW_MS = 5 * 60 * 1000;
const RATE_AUTH_MAX = 60;
const RATE_AUTH_WINDOW_MS = 5 * 60 * 1000;
const PUBLISH_MAX_PER_DAY = 3;
const PUBLISH_WINDOW_MS = 24 * 60 * 60 * 1000;

const MAX_BODY_BYTES = 256 * 1024;
const MAX_TREE_NODES = 600;
const MAX_INSTRUCTION_CHARS = 2000;
const MAX_HISTORY_ITEMS = 6;
const MAX_REPLY_CHARS = 600;
const OPENROUTER_TIMEOUT_MS = 30 * 1000;
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
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
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
  arr.push(now);
  rateBuckets.set(key, arr);
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) if (v.every((t) => now - t >= windowMs)) rateBuckets.delete(k);
  }
  return arr.length <= max;
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

function compactTree(documentObj) {
  if (!documentObj || typeof documentObj !== "object" || !documentObj.nodes || typeof documentObj.nodes !== "object") {
    return null;
  }
  const out = [];
  for (const node of Object.values(documentObj.nodes)) {
    if (!node || typeof node.id !== "string") continue;
    out.push({
      id: node.id.slice(0, 24),
      parentId: typeof node.parentId === "string" ? node.parentId.slice(0, 24) : null,
      text: String(node.text || "").slice(0, NODE_TEXT_MAX),
      order: Number.isFinite(node.order) ? node.order : null,
      color: typeof node.color === "string" && NODE_COLORS.has(node.color) ? node.color : undefined,
      dir: ["n", "e", "s", "w"].includes(node.dir) ? node.dir : undefined,
    });
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

const SYSTEM_PROMPT = `Du bist ein Assistent, der Mindmaps bearbeitet.
Der Nutzer beschreibt Änderungen an seiner Mindmap. Du antwortest IMMER und NUR mit einem einzigen JSON-Objekt, ohne Markdown, ohne Code-Fences, ohne Text außen herum:

{"reply":"<kurze Antwort auf Deutsch, höchstens 2 Sätze>","ops":[ ... ]}

Mögliche Ops (werden in der Reihenfolge ausgeführt):
- {"op":"add","parentId":"<id eines vorhandenen Knotens>","text":"<kurzer Knotentext>","color":"gold|green|cyan|blue|orange"}
- {"op":"rename","id":"<vorhandene id>","text":"<neuer Text>"}
- {"op":"delete","id":"<vorhandene id, nie root>"}   (löscht den Knoten mit allen Nachkommen)
- {"op":"move","id":"<vorhandene id>","newParentId":"<vorhandene id>"}
- {"op":"style","style":{"color":"color|mono","line":"curve|straight|elbow","nodes":"mixed|filled|outline|text","layout":"horizontal|vertical|around|radial|mixed"}}
- {"op":"relayout"}   (ordnet die Karte neu an)

Regeln:
- Benutze NUR ids, die in der angegebenen Karte existieren. Erfinde nie eigene ids für neue Knoten — gib nur die parentId des Zielknotens an.
- "root" ist die Wurzel der Karte. delete nie auf "root".
- Knotentexte kurz halten (Stichworte, wie eine echte Mindmap).
- Wenn der Auftrag unklar ist: keine Ops, stattdessen eine kurze Rückfrage im reply.
- Wenn nichts zu ändern ist: leeres ops-Array und kurze Bestätigung im reply.
- Im reply knapp sagen, was du geändert hast.`;

function buildMessages(tree, instruction, history) {
  const messages = [{ role: "system", content: SYSTEM_PROMPT }];
  for (const item of history) messages.push({ role: item.role, content: item.content });
  messages.push({
    role: "user",
    content: `Karte (Knoten als JSON-Liste):\n${JSON.stringify(tree)}\n\nAuftrag: ${instruction}`,
  });
  return messages;
}

async function callOpenRouter(model, messages) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://mindmap.orga-hero.com",
        "X-Title": "Mindmap",
      },
      body: JSON.stringify({ model, messages, max_tokens: MAX_OUTPUT_TOKENS, temperature: 0.2 }),
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
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("openrouter: leere Antwort");
    return { content, model: data.model || model };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Antwort parsen/säubern ----------

function extractJson(content) {
  let text = content.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function sanitizeOps(rawOps) {
  if (!Array.isArray(rawOps)) return [];
  const seenIds = new Set();
  const ops = [];
  for (const raw of rawOps.slice(0, 50)) {
    if (!raw || typeof raw !== "object") continue;
    const op = raw.op;
    if (op === "add") {
      const parentId = str(raw.parentId, 24);
      const text = str(raw.text, NODE_TEXT_MAX);
      if (!parentId || !text) continue;
      const out = { op: "add", parentId, text };
      if (typeof raw.color === "string" && NODE_COLORS.has(raw.color) && raw.color !== "root") out.color = raw.color;
      ops.push(out);
    } else if (op === "rename") {
      const id = str(raw.id, 24);
      const text = str(raw.text, NODE_TEXT_MAX);
      if (id && text) ops.push({ op: "rename", id, text });
    } else if (op === "delete") {
      const id = str(raw.id, 24);
      if (id && id !== "root") ops.push({ op: "delete", id });
    } else if (op === "move") {
      const id = str(raw.id, 24);
      const newParentId = str(raw.newParentId, 24);
      if (id && newParentId && id !== "root" && id !== newParentId) ops.push({ op: "move", id, newParentId });
    } else if (op === "style") {
      const style = raw.style && typeof raw.style === "object" ? raw.style : raw;
      const allowed = {};
      if (["color", "mono"].includes(style.color)) allowed.color = style.color;
      if (["curve", "straight", "elbow"].includes(style.line)) allowed.line = style.line;
      if (["mixed", "filled", "outline", "text"].includes(style.nodes)) allowed.nodes = style.nodes;
      if (["horizontal", "vertical", "around", "radial", "mixed"].includes(style.layout)) allowed.layout = style.layout;
      if (Object.keys(allowed).length > 0) ops.push({ op: "style", style: allowed });
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

  if (!OPENROUTER_API_KEY) {
    sendJson(res, 503, { error: "API-Key nicht konfiguriert", hint: "OPENROUTER_API_KEY in der Server-.env fehlt." });
    return;
  }

  try {
    const { content, model: usedModel } = await callOpenRouter(model, buildMessages(tree, instruction, history));
    const json = extractJson(content);
    const reply = sanitizeReply(json?.reply);
    const ops = sanitizeOps(json?.ops);
    log(ip, tier, usedModel, `ops=${ops.length}`);
    sendJson(res, 200, { reply, ops, model: usedModel, authed });
  } catch (err) {
    if (err.name === "AbortError") {
      sendJson(res, 504, { error: "Das Modell hat zu lange gebraucht. Bitte nochmal versuchen." });
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

// ---------- Server ----------

const server = http.createServer((req, res) => {
  const url = (req.url || "").split("?")[0].replace(/\/+$/, "") || "/";

  if (req.method === "GET" && (url === "/api/health" || url === "/health")) {
    sendJson(res, 200, {
      ok: true,
      modelPublic: MODEL_PUBLIC,
      modelAuth: MODEL_AUTH,
      keyConfigured: Boolean(OPENROUTER_API_KEY),
      authConfigured: Boolean(AUTH_USER && AUTH_HASH),
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

mkdir(DATA_DIR, { recursive: true })
  .then(() => seedIfEmpty())
  .catch((err) => log("ERROR beim Daten-Verzeichnis/Seed:", err.message))
  .finally(() => {
    server.listen(PORT, () => {
      log(
        `listening on :${PORT}`,
        `keyConfigured=${Boolean(OPENROUTER_API_KEY)}`,
        `authConfigured=${Boolean(AUTH_USER && AUTH_HASH)}`,
        `dataDir=${DATA_DIR}`,
      );
    });
  });
