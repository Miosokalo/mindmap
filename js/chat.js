/**
 * Chat-Panel: Aufträge an einen Assistenten, der die Mindmap ändert.
 * Backend: POST /api/chat (Proxy auf dem Server, Key liegt nur dort).
 * Ohne Zugang: kleines Modell. Mit Zugang (Schlüssel-Button): besseres Modell.
 * Nach strukturellen Änderungen läuft eine Qualitätskontrolle im Hintergrund;
 * Korrekturen nur nach Bestätigung im Popup.
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
  const reviewDialog = document.getElementById("review-dialog");
  const reviewReasonEl = document.getElementById("review-reason");
  const reviewApply = document.getElementById("review-apply");
  const reviewSkip = document.getElementById("review-skip");

  if (!panel || !toggle || !messagesEl || !form || !input) return;

  let history = [];
  let busy = false;
  let auth = sessionStorage.getItem("mindmap.chat.auth") || "";
  let reviewAbort = null;
  let reviewToken = 0;
  let pendingReview = null;

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

  // ref aus dieser Antwort → echte Knoten-Id. Gilt nur für den laufenden Ops-Lauf.
  function resolveRef(id, refs) {
    return refs.has(id) ? refs.get(id) : id;
  }

  function nodeDepth(id) {
    let depth = 0;
    let current = state.nodes[id];
    const seen = new Set();
    while (current && current.parentId && !seen.has(current.id)) {
      seen.add(current.id);
      depth += 1;
      current = state.nodes[current.parentId];
    }
    return depth;
  }

  const ICON_REF_RE = /^(lucide|gen):[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

  async function resolveAutoIconOps(ops) {
    const autos = (ops || []).filter((op) => op && op.op === "icon" && op.icon === "auto" && op.id);
    if (!autos.length) return [];
    const targets = [];
    const seen = new Set();
    for (const op of autos) {
      const node = state.nodes[op.id];
      if (!node || seen.has(node.id)) continue;
      seen.add(node.id);
      targets.push({ id: node.id, text: node.text });
    }
    if (!targets.length) return [];
    try {
      const headers = { "Content-Type": "application/json" };
      if (auth) headers.Authorization = `Basic ${auth}`;
      const res = await fetch("/api/icons/assign", {
        method: "POST",
        headers,
        body: JSON.stringify({ targets, allowGenerate: true }),
      });
      const data = await res.json().catch(() => null);
      return (data && data.assignments ? data.assignments : [])
        .filter((a) => a && a.id && a.icon)
        .map((a) => ({ op: "icon", id: a.id, icon: a.icon }));
    } catch {
      return [];
    }
  }

  function applyOps(ops) {
    const summary = { added: 0, renamed: 0, deleted: 0, moved: 0, styled: false, relaid: false, icons: 0 };
    const skipped = [];
    const refs = new Map();
    let structural = false;
    let pending = ops.slice(0, MAX_SUMMARY_OPS);
    const declared = new Set(pending.filter((op) => op && op.op === "add" && op.ref).map((op) => op.ref));

    function waiting(token) {
      return typeof token === "string" && declared.has(token) && !refs.has(token) && !state.nodes[token];
    }

    function applyOne(op) {
      if (op.op === "add") {
        const parentId = resolveRef(op.parentId, refs);
        if (!state.nodes[parentId]) throw new Error(`Eltern fehlt: ${op.parentId}`);
        if (nodeDepth(parentId) >= 4) throw new Error(`Zu tief unter ${op.parentId}`);
        const id = addChild(parentId, { text: String(op.text), silent: true });
        const node = id && state.nodes[id];
        if (!node) throw new Error("Knoten wurde nicht angelegt");
        if (op.color && CHAT_COLORS.has(op.color)) node.color = op.color;
        if (op.ref) refs.set(op.ref, id);
        structural = true;
        summary.added += 1;
      } else if (op.op === "rename") {
        const node = state.nodes[resolveRef(op.id, refs)];
        if (!node) throw new Error(`Knoten fehlt: ${op.id}`);
        node.text = String(op.text).slice(0, 200);
          node.w = textWidth(node.text, !!node.parentId, node);
        structural = true;
        summary.renamed += 1;
      } else if (op.op === "delete") {
        const id = resolveRef(op.id, refs);
        if (!state.nodes[id] || id === "root") throw new Error(`Knoten fehlt: ${op.id}`);
        deleteNode(id);
        structural = true;
        summary.deleted += 1;
      } else if (op.op === "move") {
        const node = state.nodes[resolveRef(op.id, refs)];
        const newParentId = resolveRef(op.newParentId, refs);
        if (!node || node.id === "root") throw new Error(`Knoten fehlt: ${op.id}`);
        if (!state.nodes[newParentId]) throw new Error(`Eltern fehlt: ${op.newParentId}`);
        if (nodeDepth(newParentId) >= 4) throw new Error(`Zu tief unter ${op.newParentId}`);
        node.parentId = newParentId;
        node.order = childrenOf(newParentId).length - 1;
        structural = true;
        summary.moved += 1;
      } else if (op.op === "icon") {
        const node = state.nodes[resolveRef(op.id, refs)];
        if (!node) throw new Error(`Knoten fehlt: ${op.id}`);
        if (op.icon === null || op.icon === "") {
          delete node.icon;
        } else if (typeof op.icon === "string" && ICON_REF_RE.test(op.icon)) {
          node.icon = op.icon;
        } else {
          throw new Error(`Icon ungültig: ${op.icon}`);
        }
        node.w = textWidth(node.text, !!node.parentId, node);
        structural = true;
        summary.icons += 1;
      } else if (op.op === "style") {
        Mindmap.setStyle(op.style || {});
        summary.styled = true;
      } else if (op.op === "relayout") {
        structural = true;
        summary.relaid = true;
      }
    }

    while (pending.length) {
      const later = [];
      let progressed = false;
      for (const op of pending) {
        const defer =
          (op.op === "add" && waiting(op.parentId)) ||
          (op.op === "move" && (waiting(op.id) || waiting(op.newParentId))) ||
          ((op.op === "rename" || op.op === "delete" || op.op === "icon") && waiting(op.id));
        if (defer) {
          later.push(op);
          continue;
        }
        progressed = true;
        try {
          applyOne(op);
        } catch (err) {
          skipped.push(err.message);
        }
      }
      if (!progressed) {
        for (const op of later) skipped.push(`Eltern fehlt: ${op.parentId || op.id}`);
        break;
      }
      pending = later;
    }

    if (structural) {
      relayoutCollided(state.nodes, state.style, "root");
      state.centered = false;
      centerIfNeeded();
    }
    saveState();
    render();
    return { summary, skipped, structural };
  }

  function summarize(summary) {
    const parts = [];
    if (summary.added) parts.push(`${summary.added} Knoten ergänzt`);
    if (summary.renamed) parts.push(`${summary.renamed} umbenannt`);
    if (summary.deleted) parts.push(`${summary.deleted} gelöscht`);
    if (summary.moved) parts.push(`${summary.moved} verschoben`);
    if (summary.icons) parts.push(`${summary.icons} Icons`);
    if (summary.styled) parts.push("Stil geändert");
    if (summary.relaid) parts.push("neu angeordnet");
    return parts.join(" · ") || null;
  }

  // ---------- API ----------

  async function postChat(body, signal) {
    const headers = { "Content-Type": "application/json" };
    if (auth) headers.Authorization = `Basic ${auth}`;
    const payload = JSON.stringify(body);
    let res;
    try {
      res = await fetch("/api/chat", { method: "POST", headers, body: payload, signal });
    } catch (err) {
      if (signal && signal.aborted) throw err;
      if (!/Failed to fetch|NetworkError|Load failed/i.test(err && err.message)) throw err;
      res = await fetch("/api/chat", { method: "POST", headers, body: payload, signal });
    }
    const raw = await res.text();
    let data = null;
    try {
      data = JSON.parse(raw.trim());
    } catch {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          data = JSON.parse(raw.slice(start, end + 1));
        } catch {
          data = null;
        }
      }
    }
    if (!res.ok || !data || data.error) {
      throw new Error(data && data.error ? data.error : `Serverfehler (${res.status})`);
    }
    return data;
  }

  // ---------- Qualitätskontrolle ----------

  function cancelReview() {
    reviewToken += 1;
    if (reviewAbort) {
      reviewAbort.abort();
      reviewAbort = null;
    }
    hideReviewDialog();
    pendingReview = null;
    const pending = messagesEl.querySelector(".chat-message.review-pending");
    if (pending) pending.remove();
  }

  function hideReviewDialog() {
    if (!reviewDialog) return;
    reviewDialog.hidden = true;
  }

  function showReviewDialog(reason, ops) {
    if (!reviewDialog || !reviewReasonEl) return;
    pendingReview = { reason, ops };
    reviewReasonEl.textContent = reason || "Die Kontrolle schlägt eine Korrektur vor.";
    reviewDialog.hidden = false;
  }

  function applyPendingReview() {
    if (!pendingReview) {
      hideReviewDialog();
      return;
    }
    const { ops, reason } = pendingReview;
    pendingReview = null;
    hideReviewDialog();
    if (typeof Mindmap.pushHistory === "function") Mindmap.pushHistory();
    const { summary, skipped } =
      typeof Mindmap.withoutHistory === "function"
        ? Mindmap.withoutHistory(() => applyOps(ops || []))
        : applyOps(ops || []);
    const changes = summarize(summary);
    let text = "Korrektur übernommen.";
    if (reason) text += ` ${reason}`;
    if (changes) text += `\n(${changes})`;
    if (skipped.length) text += `\nÜbersprungen: ${skipped.join("; ")}`;
    addMessage("assistant", text);
  }

  function skipPendingReview() {
    pendingReview = null;
    hideReviewDialog();
    addMessage("assistant", "Korrektur verworfen — die Karte bleibt wie angezeigt.");
  }

  async function runReview(instruction, token) {
    if (!reviewDialog) return;
    const status = addMessage("assistant pending review-pending", "prüft Ergebnis …");
    const controller = new AbortController();
    reviewAbort = controller;
    try {
      const data = await postChat(
        {
          document: { nodes: compactTree() },
          instruction,
          history: [],
          mode: "review",
        },
        controller.signal,
      );
      if (token !== reviewToken) return;
      status.remove();
      if (data.model && modelEl) {
        modelEl.title = `Letzte Kontrolle: ${data.model}`;
      }
      const ops = Array.isArray(data.ops) ? data.ops : [];
      if (data.needsCorrection && ops.length) {
        const reason = data.reason || data.reply || "Korrektur vorgeschlagen.";
        addMessage("assistant", `Kontrolle: ${data.reply || "Korrektur möglich."}`);
        showReviewDialog(reason, ops);
      } else {
        addMessage("assistant", `Kontrolle: ${data.reply || "Sieht stimmig aus."}`);
      }
    } catch (err) {
      if (token !== reviewToken) return;
      status.remove();
      if (err && err.name === "AbortError") return;
      // Stille Kontrolle — Nutzer nicht mit Nebenfehlern belasten.
      console.warn("[chat-review]", err && err.message);
    } finally {
      if (reviewAbort === controller) reviewAbort = null;
    }
  }

  function shouldReview(ops, structural) {
    if (!ops || !ops.length) return false;
    return structural || ops.some((op) => op.op === "add" || op.op === "rename" || op.op === "delete" || op.op === "move");
  }

  // ---------- Senden ----------

  async function send(instruction) {
    if (busy || !instruction.trim()) return;
    busy = true;
    sendButton.disabled = true;
    cancelReview();
    addMessage("user", instruction);

    const thinking = addMessage("assistant pending", "denkt nach …");
    try {
      const data = await postChat({
        document: { nodes: compactTree() },
        instruction,
        history,
      });

      thinking.remove();
      const rawOps = data.ops || [];
      const firstPass = rawOps.filter((op) => !(op && op.op === "icon" && op.icon === "auto"));
      const autoOps = rawOps.filter((op) => op && op.op === "icon" && op.icon === "auto");
      if (typeof Mindmap.pushHistory === "function" && (firstPass.length || autoOps.length)) {
        Mindmap.pushHistory();
      }
      const runApply = (ops) =>
        typeof Mindmap.withoutHistory === "function" ? Mindmap.withoutHistory(() => applyOps(ops)) : applyOps(ops);
      const applied = runApply(firstPass);
      let summary = applied.summary;
      let skipped = applied.skipped;
      let structural = applied.structural;
      if (autoOps.length) {
        const resolved = await resolveAutoIconOps(autoOps);
        if (resolved.length) {
          const second = runApply(resolved);
          summary = {
            ...summary,
            icons: (summary.icons || 0) + (second.summary.icons || 0),
          };
          skipped = skipped.concat(second.skipped);
          structural = structural || second.structural;
        }
      }
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

      if (shouldReview(rawOps, structural)) {
        const token = reviewToken;
        // Ergebnis ist schon sichtbar — Kontrolle läuft im Hintergrund.
        runReview(instruction, token);
      }
    } catch (err) {
      thinking.remove();
      const lost = /Failed to fetch|NetworkError|Load failed/i.test(err && err.message);
      addMessage("error", lost ? "Die Verbindung ist abgebrochen. Bitte die Anfrage nochmal senden." : `${err.message}`);
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

  function setChatOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.title = open ? "Assistenten schließen" : "Assistenten öffnen";
    if (!open) return;
    if (!messagesEl.childElementCount) {
      addMessage("assistant", "Ich ändere die Karte auf Zuruf — z. B. „Füge unter der Wurzel einen Knoten Wetter an“ oder „Lösche alles zu Insekten“.");
    }
    input.focus();
  }

  toggle.addEventListener("click", () => setChatOpen(panel.hidden));

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

  if (reviewApply) reviewApply.addEventListener("click", applyPendingReview);
  if (reviewSkip) reviewSkip.addEventListener("click", skipPendingReview);
  if (reviewDialog) {
    reviewDialog.addEventListener("click", (event) => {
      if (event.target === reviewDialog) skipPendingReview();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && reviewDialog && !reviewDialog.hidden) skipPendingReview();
    });
  }

  setModelLabel();
})();
