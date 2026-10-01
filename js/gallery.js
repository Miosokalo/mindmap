/**
 * Start-Ansicht (großes „Neue Mindmap erstellen“ + Galerie), Ansichtsmodus für
 * veröffentlichte Karten und der Veröffentlichungs-Dialog (gesicherte Nachfrage:
 * „veröffentlichen“ eintippen). Alles Lokale bleibt privat im Browser;
 * veröffentlicht wird nur, wer den Dialog ausdrücklich bestätigt.
 * Läuft nach app.js/chat.js im selben globalen Scope (klassische <script>-Tags).
 */
(() => {
  const LS_KEY = "mindmap.v2";

  const startEl = document.getElementById("start");
  const startNew = document.getElementById("start-new");
  const startContinue = document.getElementById("start-continue");
  const startContinueTitle = document.getElementById("start-continue-title");
  const galleryCards = document.getElementById("gallery-cards");
  const galleryEmpty = document.getElementById("gallery-empty");
  const galleryError = document.getElementById("gallery-error");
  const topbar = document.getElementById("topbar");
  const viewport = document.getElementById("viewport");
  const viewBanner = document.getElementById("view-banner");
  const viewTitle = document.getElementById("view-title");
  const viewBack = document.getElementById("view-back");
  const viewAdopt = document.getElementById("view-adopt");
  const backStart = document.getElementById("back-start");
  const publishButton = document.getElementById("publish");
  const publishDialog = document.getElementById("publish-dialog");
  const publishTitle = document.getElementById("publish-title");
  const publishNodeCount = document.getElementById("publish-node-count");
  const publishConfirm = document.getElementById("publish-confirm");
  const publishCancel = document.getElementById("publish-cancel");
  const publishSubmit = document.getElementById("publish-submit");
  const toastEl = document.getElementById("toast");
  const chatPanel = document.getElementById("chat");
  const chatToggle = document.getElementById("chat-toggle");

  // saveState aus app.js so wrappen, dass im Ansichtsmodus nichts in
  // localStorage geschrieben wird (die eigene Karte bleibt unangetastet).
  const origSaveState = saveState;
  saveState = function () {
    if (!window.MINDMAP_VIEWING) origSaveState();
  };

  let ownMapBackup = null;
  let publishBusy = false;

  // ---------- Ansichten ----------

  function showStart() {
    startEl.hidden = false;
    topbar.hidden = true;
    viewport.hidden = true;
    viewBanner.hidden = true;
    if (chatPanel) chatPanel.hidden = true;
    refreshContinue();
    loadGallery();
  }

  function showEditor() {
    startEl.hidden = true;
    topbar.hidden = false;
    viewport.hidden = false;
    viewport.style.display = "";
  }

  function setViewing(on) {
    window.MINDMAP_VIEWING = on;
    document.body.classList.toggle("mindmap-viewing", on);
    for (const id of ["add-child", "delete-node", "relayout", "publish", "style-color", "style-line", "style-nodes", "style-layout"]) {
      const el = document.getElementById(id);
      if (el) el.disabled = on;
    }
    if (chatPanel && on) chatPanel.hidden = true;
    viewBanner.hidden = !on;
  }

  // ---------- Eigene Karte ----------

  function localMap() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.nodes && parsed.nodes.root) return parsed;
      return null;
    } catch {
      return null;
    }
  }

  function refreshContinue() {
    const map = localMap();
    startContinue.hidden = !map;
    if (map) {
      startContinueTitle.textContent = (map.nodes.root.text || "Meine Karte").slice(0, 40);
    }
  }

  function newMap() {
    const existing = localMap();
    if (existing && !confirm("Du hast bereits eine Karte. Soll sie durch eine neue ersetzt werden?")) return;
    Mindmap.setDocument({
      version: 1,
      style: { color: "color", line: "curve", nodes: "mixed", layout: "around" },
      camera: { panX: 0, panY: 0, zoom: 1 },
      nodes: {
        root: { id: "root", parentId: null, text: "Neues Thema", x: 0, y: 0, w: 130, h: 22, order: 0 },
      },
    });
    Mindmap.relayout("root");
    state.centered = false;
    centerIfNeeded();
    showEditor();
    const rootText = document.querySelector('[data-id="root"] .node-text');
    if (rootText) beginEdit("root", rootText);
  }

  // ---------- Galerie ----------

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });
    } catch {
      return "";
    }
  }

  async function loadGallery() {
    galleryCards.replaceChildren();
    galleryEmpty.hidden = true;
    galleryError.hidden = true;
    try {
      const res = await fetch("/api/maps");
      if (!res.ok) throw new Error(`Serverfehler (${res.status})`);
      const data = await res.json();
      const maps = data.maps || [];
      if (maps.length === 0) {
        galleryEmpty.hidden = false;
        return;
      }
      for (const map of maps) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "gallery-card";
        const title = document.createElement("span");
        title.className = "gallery-card-title";
        title.textContent = map.title;
        const meta = document.createElement("span");
        meta.className = "gallery-card-meta";
        meta.textContent = `${map.nodeCount} Knoten · ${formatDate(map.publishedAt)}`;
        card.append(title, meta);
        card.addEventListener("click", () => viewMap(map.id));
        galleryCards.append(card);
      }
    } catch (err) {
      galleryError.textContent = `Galerie konnte nicht geladen werden (${err.message}).`;
      galleryError.hidden = false;
    }
  }

  async function viewMap(id) {
    try {
      const res = await fetch(`/api/maps/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(res.status === 404 ? "Karte nicht gefunden" : `Serverfehler (${res.status})`);
      const data = await res.json();
      ownMapBackup = localStorage.getItem(LS_KEY);
      setViewing(true);
      viewTitle.textContent = data.title;
      Mindmap.setDocument(data.document);
      Mindmap.relayout("root");
      state.centered = false;
      centerIfNeeded();
      showEditor();
    } catch (err) {
      alert(`Karte konnte nicht geladen werden: ${err.message}`);
    }
  }

  function exitView() {
    setViewing(false);
    if (ownMapBackup !== null) {
      const backup = ownMapBackup;
      ownMapBackup = null;
      localStorage.setItem(LS_KEY, backup);
      try {
        const restored = JSON.parse(backup);
        if (restored && restored.nodes && restored.nodes.root) {
          // Kompletten Zustand wiederherstellen — inkl. Kamera (panX/panY/zoom),
          // Auswahl und centered-Flag, nicht nur Nodes/Style.
          state.nodes = JSON.parse(JSON.stringify(restored.nodes));
          state.style = withStyle({ style: restored.style || {} }).style;
          state.panX = Number.isFinite(restored.panX) ? restored.panX : state.panX;
          state.panY = Number.isFinite(restored.panY) ? restored.panY : state.panY;
          state.zoom = Number.isFinite(restored.zoom) ? restored.zoom : state.zoom;
          state.selectedId = restored.selectedId || "root";
          state.centered = !!restored.centered;
          state.mapVersion = MAP_VERSION;
          syncStyleControls();
          saveState();
          render();
          showEditor();
        } else {
          showEditor();
        }
      } catch {
        /* Backup unverständlich — Karte im Speicher bleibt */
        showEditor();
      }
    } else {
      showStart();
    }
  }

  function adoptCopy() {
    if (localMap() && !confirm("Deine aktuelle Karte wird durch diese Kopie ersetzt. Fortfahren?")) return;
    ownMapBackup = null;
    setViewing(false);
    saveState();
    showEditor();
    toast("Als eigene Kopie übernommen — jetzt bleibt alles lokal bei dir.");
  }

  // ---------- Veröffentlichen (gesicherte Nachfrage) ----------

  function openPublish() {
    publishTitle.value = (state.nodes.root && state.nodes.root.text) || "";
    publishNodeCount.textContent = String(nodeList().length);
    publishConfirm.value = "";
    publishSubmit.disabled = true;
    publishDialog.hidden = false;
    publishTitle.focus();
  }

  function closePublish() {
    publishDialog.hidden = true;
  }

  async function doPublish() {
    if (publishBusy) return;
    publishBusy = true;
    publishSubmit.disabled = true;
    publishSubmit.textContent = "Veröffentliche …";
    try {
      const res = await fetch("/api/maps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document: Mindmap.getDocument(), title: publishTitle.value.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error((data && data.error) || `Serverfehler (${res.status})`);
      closePublish();
      toast(`Veröffentlicht! „${data.title}“ liegt jetzt in der Galerie.`);
    } catch (err) {
      alert(`Veröffentlichen fehlgeschlagen: ${err.message}`);
    } finally {
      publishBusy = false;
      publishSubmit.textContent = "Veröffentlichen";
      publishSubmit.disabled = publishConfirm.value.trim().toLowerCase() !== "veröffentlichen";
    }
  }

  // ---------- Toast ----------

  let toastTimer = null;

  function toast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, 6000);
  }

  // ---------- Verdrahtung ----------

  startNew.addEventListener("click", newMap);
  startContinue.addEventListener("click", () => showEditor());
  backStart.addEventListener("click", () => {
    if (window.MINDMAP_VIEWING) exitView();
    else showStart();
  });
  if (viewBack) viewBack.addEventListener("click", exitView);
  if (viewAdopt) viewAdopt.addEventListener("click", adoptCopy);
  publishButton.addEventListener("click", openPublish);
  publishCancel.addEventListener("click", closePublish);
  publishConfirm.addEventListener("input", () => {
    publishSubmit.disabled = publishConfirm.value.trim().toLowerCase() !== "veröffentlichen";
  });
  publishConfirm.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !publishSubmit.disabled) doPublish();
  });
  publishSubmit.addEventListener("click", doPublish);
  publishDialog.addEventListener("click", (event) => {
    if (event.target === publishDialog) closePublish();
  });

  showStart();
})();
