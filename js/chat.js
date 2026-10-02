/**
 * Chat-Panel: Aufträge an einen Assistenten, der die Mindmap ändert.
 * Backend: POST /api/chat (Proxy auf dem Server, Key liegt nur dort).
 * Ohne Zugang: kleines Modell. Mit Zugang (Schlüssel-Button): besseres Modell.
 * Ops werden über die Funktionen aus app.js/layout.js angewandt (gleicher
 * globaler Scope, da klassische <script>-Tags).
 */
(() => {
  const CHAT_COLORS = new Set(["gold", "green", "cyan", "blue", "orange"]);
  const MAX_SUMMARY_OPS = 50;

  const panel = document.getElementById("chat");
  const toggle = document.getElementById("chat-toggle");
  const messagesEl = document.getElementById("chat-messages");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const sendButton = document.getElementById("chat-send");
  const modelEl = document.getElementById("chat-model");
  const authButton = document.getElementById("chat-auth");

  if (!panel || !toggle || !messagesEl || !form || !input) return;

  let history = [];
  let busy = false;
  let auth = sessionStorage.getItem("mindmap.chat.auth") || "";

  // ---------- Anzeige ----------

  function addMessage(kind, text) {
    const el = document.createElement("div");
    el.className = `chat-message ${kind}`;
    el.textContent = text;
    messagesEl.append(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  function setModelLabel() {
    fetch("/api/health")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || !modelEl) return;
        const own = auth ? data.modelAuth : data.modelPublic;
        modelEl.textContent = auth ? "mit Zugang" : "kleines Modell";
        modelEl.title = `Öffentlich: ${data.modelPublic}\nMit Zugang: ${data.modelAuth}${auth ? `\nAktuell: ${own}` : ""}`;
      })
      .catch(() => {});
  }

  // ---------- Karte kompakt ----------

  function compactTree() {
    const doc = Mindmap.getDocument();
    return Object.values(doc.nodes).map((node) => ({
      id: node.id,
      parentId: node.parentId || null,
      text: node.text,
      order: Number.isFinite(node.order) ? node.order : null,
      color: node.color,
      dir: node.dir,
    }));
  }

  // ---------- Ops anwenden (nutzt app.js / layout.js) ----------

  function relayoutFrom(nodeId) {
    relayoutNodes(state.nodes, state.style, nodeId || "root", textWidth);
  }

  function applyOps(ops) {
    const summary = { added: 0, renamed: 0, deleted: 0, moved: 0, styled: false, relaid: false };
    const skipped = [];

    for (const op of ops.slice(0, MAX_SUMMARY_OPS)) {
      try {
        if (op.op === "add") {
          if (!state.nodes[op.parentId]) throw new Error(`Eltern fehlt: ${op.parentId}`);
          addChild(op.parentId);
          const id = state.selectedId;
          const node = state.nodes[id];
          if (!node) throw new Error("Knoten wurde nicht angelegt");
          node.text = String(op.text).slice(0, 200);
          node.w = textWidth(node.text, false);
          if (op.color && CHAT_COLORS.has(op.color)) node.color = op.color;
          relayoutFrom(op.parentId);
          summary.added += 1;
        } else if (op.op === "rename") {
          const node = state.nodes[op.id];
          if (!node) throw new Error(`Knoten fehlt: ${op.id}`);
          node.text = String(op.text).slice(0, 200);
          node.w = textWidth(node.text, node.parentId ? false : true);
          relayoutFrom(node.parentId || "root");
          summary.renamed += 1;
        } else if (op.op === "delete") {
          if (!state.nodes[op.id] || op.id === "root") throw new Error(`Knoten fehlt: ${op.id}`);
          deleteNode(op.id);
          summary.deleted += 1;
        } else if (op.op === "move") {
          const node = state.nodes[op.id];
          if (!node || op.id === "root") throw new Error(`Knoten fehlt: ${op.id}`);
          if (!state.nodes[op.newParentId]) throw new Error(`Eltern fehlt: ${op.newParentId}`);
          node.parentId = op.newParentId;
          node.order = childrenOf(op.newParentId).length - 1;
          relayoutFrom(op.newParentId);
          summary.moved += 1;
        } else if (op.op === "style") {
          Mindmap.setStyle(op.style || {});
          summary.styled = true;
        } else if (op.op === "relayout") {
          relayoutFrom("root");
          state.centered = false;
          centerIfNeeded();
          summary.relaid = true;
        }
      } catch (err) {
        skipped.push(err.message);
      }
    }

    saveState();
    render();
    return { summary, skipped };
  }

  function summarize(summary) {
    const parts = [];
    if (summary.added) parts.push(`${summary.added} Knoten ergänzt`);
    if (summary.renamed) parts.push(`${summary.renamed} umbenannt`);
    if (summary.deleted) parts.push(`${summary.deleted} gelöscht`);
    if (summary.moved) parts.push(`${summary.moved} verschoben`);
    if (summary.styled) parts.push("Stil geändert");
    if (summary.relaid) parts.push("neu angeordnet");
    return parts.join(" · ") || null;
  }

  // ---------- Senden ----------

  async function send(instruction) {
    if (busy || !instruction.trim()) return;
    busy = true;
    sendButton.disabled = true;
    addMessage("user", instruction);

    const thinking = addMessage("assistant pending", "denkt nach …");
    try {
      const headers = { "Content-Type": "application/json" };
      if (auth) headers.Authorization = `Basic ${auth}`;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers,
        body: JSON.stringify({
          document: { nodes: compactTree() },
          instruction,
          history,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        throw new Error(data && data.error ? data.error : `Serverfehler (${res.status})`);
      }

      thinking.remove();
      const { summary, skipped } = applyOps(data.ops || []);
      const changes = summarize(summary);
      let text = data.reply || "";
      if (changes) text += `\n(${changes})`;
      if (skipped.length) text += `\nÜbersprungen: ${skipped.join("; ")}`;
      addMessage("assistant", text);
      if (data.model && modelEl) {
        modelEl.textContent = auth ? "mit Zugang" : "kleines Modell";
        modelEl.title = `Letzte Antwort: ${data.model}`;
      }

      history.push({ role: "user", content: instruction.slice(0, 2000) });
      history.push({ role: "assistant", content: (data.reply || "").slice(0, 2000) });
      history = history.slice(-6);
    } catch (err) {
      thinking.remove();
      addMessage("error", `${err.message}`);
    } finally {
      busy = false;
      sendButton.disabled = false;
      input.focus();
    }
  }

  // ---------- Zugang (Basic Auth für bessere Modelle) ----------

  function askAuth() {
    const user = prompt("Benutzername für den Assistenten-Zugang (leer lassen für das kleine Modell):");
    if (user === null) return;
    const pass = user === "" ? "" : prompt("Passwort:");
    if (pass === null) return;
    if (user === "" || pass === "") {
      auth = "";
      sessionStorage.removeItem("mindmap.chat.auth");
    } else {
      auth = btoa(`${user}:${pass}`);
      sessionStorage.setItem("mindmap.chat.auth", auth);
    }
    setModelLabel();
    addMessage("assistant", auth ? "Zugang gesetzt — Antworten nutzen das bessere Modell." : "Zugang entfernt — Antworten nutzen das kleine Modell.");
  }

  // ---------- Verdrahtung ----------

  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      if (!messagesEl.childElementCount) {
        addMessage("assistant", "Ich ändere die Karte auf Zuruf — z. B. „Füge unter der Wurzel einen Knoten Wetter an“ oder „Lösche alles zu Insekten“.");
      }
      input.focus();
    }
  });

  if (authButton) authButton.addEventListener("click", askAuth);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const instruction = input.value.trim();
    if (!instruction) return;
    input.value = "";
    send(instruction);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  setModelLabel();
})();
