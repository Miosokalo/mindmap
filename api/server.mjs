/**
 * Mindmap-Chat-Proxy (Zero-Dependency, node:http).
 * POST /api/chat  { document, instruction, history? } -> { reply, ops, model, authed }
 * GET  /api/health -> { ok, modelPublic, modelAuth, keyConfigured }
 *
 * OpenRouter-Key liegt nur hier (ENV), nie im Frontend.
 * Ohne Basic Auth: kleines/günstiges Modell + strenges Rate-Limit.
 * Mit Basic Auth (MINDMAP_CHAT_AUTH_USER / _HASH, scrypt$salt$hash): besseres Modell.
 */
import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT || 3000);
const OPENROUTER_API_KEY = (process.env.OPENROUTER_API_KEY || "").trim();
const MODEL_PUBLIC = (process.env.OPENROUTER_MODEL_PUBLIC || "deepseek/deepseek-chat-v3.1:free").trim();
const MODEL_AUTH = (process.env.OPENROUTER_MODEL_AUTH || "anthropic/claude-sonnet-4.5").trim();
const AUTH_USER = (process.env.MINDMAP_CHAT_AUTH_USER || "").trim();
const AUTH_HASH = (process.env.MINDMAP_CHAT_AUTH_HASH || "").trim();

const RATE_ANON_MAX = 10;
const RATE_ANON_WINDOW_MS = 5 * 60 * 1000;
const RATE_AUTH_MAX = 60;
const RATE_AUTH_WINDOW_MS = 5 * 60 * 1000;

const MAX_BODY_BYTES = 256 * 1024;
const MAX_TREE_NODES = 600;
const MAX_INSTRUCTION_CHARS = 2000;
const MAX_HISTORY_ITEMS = 6;
const MAX_REPLY_CHARS = 600;
const OPENROUTER_TIMEOUT_MS = 30 * 1000;
const MAX_OUTPUT_TOKENS = 2048;
const NODE_TEXT_MAX = 200;

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
  for (const [k, v] of rateBuckets) if (v.every((t) => now - t >= RATE_AUTH_WINDOW_MS)) rateBuckets.delete(k);
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

// ---------- Handler ----------

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

const server = http.createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/api/health" || req.url === "/health")) {
    sendJson(res, 200, {
      ok: true,
      modelPublic: MODEL_PUBLIC,
      modelAuth: MODEL_AUTH,
      keyConfigured: Boolean(OPENROUTER_API_KEY),
      authConfigured: Boolean(AUTH_USER && AUTH_HASH),
    });
    return;
  }
  if (req.method === "POST" && (req.url === "/api/chat" || req.url === "/api/chat/")) {
    handleChat(req, res).catch((err) => {
      log("FATAL", err);
      if (!res.headersSent) sendJson(res, 500, { error: "Interner Fehler" });
    });
    return;
  }
  sendJson(res, 404, { error: "Not Found" });
});

server.listen(PORT, () => {
  log(`listening on :${PORT}`, `keyConfigured=${Boolean(OPENROUTER_API_KEY)}`, `authConfigured=${Boolean(AUTH_USER && AUTH_HASH)}`);
});
