const STORAGE_KEY = "mindmap.v1";

const viewport = document.getElementById("viewport");
const world = document.getElementById("world");
const edges = document.getElementById("edges");
const nodesEl = document.getElementById("nodes");

let state = loadState();
let drag = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw);
    if (!parsed.nodes || !parsed.nodes.root) return freshState();
    return parsed;
  } catch {
    return freshState();
  }
}

function freshState() {
  return {
    panX: 0,
    panY: 0,
    zoom: 1,
    selectedId: "root",
    centered: false,
    nodes: {
      root: { id: "root", parentId: null, text: "Thema", x: 0, y: 0 },
    },
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function nodeList() {
  return Object.values(state.nodes);
}

function childrenOf(id) {
  return nodeList().filter((node) => node.parentId === id);
}

function applyTransform() {
  world.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
}

function centerIfNeeded() {
  if (state.centered) return;
  const rect = viewport.getBoundingClientRect();
  state.panX = rect.width / 2;
  state.panY = rect.height / 2;
  state.centered = true;
  saveState();
}

function render() {
  applyTransform();
  renderNodes();
  renderEdges();
}

function renderNodes() {
  nodesEl.replaceChildren();
  for (const node of nodeList()) {
    const el = document.createElement("div");
    el.className = "node" + (node.id === "root" ? " root" : "");
    if (node.id === state.selectedId) el.classList.add("selected");
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
    el.dataset.id = node.id;

    const text = document.createElement("div");
    text.className = "node-text";
    text.textContent = node.text;
    el.append(text);

    el.addEventListener("pointerdown", (event) => onNodePointerDown(event, node.id));
    el.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      beginEdit(node.id, text);
    });
    nodesEl.append(el);
  }
}

function renderEdges() {
  const points = nodeList().map((node) => ({ x: node.x, y: node.y }));
  if (points.length === 0) {
    edges.replaceChildren();
    return;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const pad = 80;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  edges.setAttribute("viewBox", `${minX} ${minY} ${width} ${height}`);
  edges.style.left = `${minX}px`;
  edges.style.top = `${minY}px`;
  edges.style.width = `${width}px`;
  edges.style.height = `${height}px`;

  const fragment = document.createDocumentFragment();
  for (const node of nodeList()) {
    if (!node.parentId) continue;
    const parent = state.nodes[node.parentId];
    if (!parent) continue;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const midX = (parent.x + node.x) / 2;
    path.setAttribute(
      "d",
      `M ${parent.x} ${parent.y} C ${midX} ${parent.y}, ${midX} ${node.y}, ${node.x} ${node.y}`,
    );
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#a8a29e");
    path.setAttribute("stroke-width", "2");
    fragment.append(path);
  }
  edges.replaceChildren(fragment);
}

function selectNode(id) {
  state.selectedId = id;
  saveState();
  render();
}

function addChild(parentId) {
  const parent = state.nodes[parentId];
  if (!parent) return;
  const siblings = childrenOf(parentId);
  const id = uid();
  state.nodes[id] = {
    id,
    parentId,
    text: "Neu",
    x: parent.x + 220,
    y: parent.y + siblings.length * 84,
  };
  state.selectedId = id;
  saveState();
  render();
}

function deleteNode(id) {
  if (!id || id === "root" || !state.nodes[id]) return;
  const drop = new Set();
  const walk = (current) => {
    drop.add(current);
    for (const child of childrenOf(current)) walk(child.id);
  };
  walk(id);
  for (const gone of drop) delete state.nodes[gone];
  state.selectedId = state.nodes[state.selectedId] ? state.selectedId : "root";
  if (drop.has(state.selectedId)) state.selectedId = "root";
  saveState();
  render();
}

function beginEdit(id, textEl) {
  const node = state.nodes[id];
  if (!node) return;
  const card = textEl.parentElement;
  card.classList.add("editing");
  textEl.contentEditable = "true";
  textEl.focus();
  const range = document.createRange();
  range.selectNodeContents(textEl);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  const finish = () => {
    textEl.contentEditable = "false";
    card.classList.remove("editing");
    node.text = textEl.textContent.trim() || "…";
    textEl.textContent = node.text;
    saveState();
    textEl.removeEventListener("blur", finish);
    textEl.removeEventListener("keydown", onKey);
  };

  const onKey = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      textEl.blur();
    }
    if (event.key === "Escape") {
      textEl.textContent = node.text;
      textEl.blur();
    }
  };

  textEl.addEventListener("blur", finish);
  textEl.addEventListener("keydown", onKey);
}

function onNodePointerDown(event, id) {
  if (event.button !== 0) return;
  if (event.target.isContentEditable) return;
  event.stopPropagation();
  state.selectedId = id;
  const node = state.nodes[id];
  drag = {
    kind: "node",
    id,
    pointerId: event.pointerId,
    originX: event.clientX,
    originY: event.clientY,
    nodeX: node.x,
    nodeY: node.y,
  };
  event.currentTarget.setPointerCapture(event.pointerId);
  render();
}

viewport.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  if (event.target.closest(".node")) return;
  drag = {
    kind: "pan",
    pointerId: event.pointerId,
    originX: event.clientX,
    originY: event.clientY,
    panX: state.panX,
    panY: state.panY,
  };
  viewport.classList.add("panning");
  viewport.setPointerCapture(event.pointerId);
});

window.addEventListener("pointermove", (event) => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (drag.kind === "pan") {
    state.panX = drag.panX + (event.clientX - drag.originX);
    state.panY = drag.panY + (event.clientY - drag.originY);
    applyTransform();
    return;
  }
  const node = state.nodes[drag.id];
  node.x = drag.nodeX + (event.clientX - drag.originX) / state.zoom;
  node.y = drag.nodeY + (event.clientY - drag.originY) / state.zoom;
  const el = nodesEl.querySelector(`[data-id="${drag.id}"]`);
  if (el) {
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
  }
  renderEdges();
});

window.addEventListener("pointerup", (event) => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  viewport.classList.remove("panning");
  drag = null;
  saveState();
});

viewport.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const next = Math.min(2.4, Math.max(0.35, state.zoom * (event.deltaY < 0 ? 1.08 : 0.92)));
    const worldX = (px - state.panX) / state.zoom;
    const worldY = (py - state.panY) / state.zoom;
    state.zoom = next;
    state.panX = px - worldX * state.zoom;
    state.panY = py - worldY * state.zoom;
    applyTransform();
    saveState();
  },
  { passive: false },
);

document.getElementById("add-child").addEventListener("click", () => {
  addChild(state.selectedId || "root");
});

document.getElementById("delete-node").addEventListener("click", () => {
  deleteNode(state.selectedId);
});

window.addEventListener("keydown", (event) => {
  const editing = document.querySelector(".node-text[contenteditable='true']");
  if (editing) return;
  if (event.key === "Tab") {
    event.preventDefault();
    addChild(state.selectedId || "root");
  } else if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    deleteNode(state.selectedId);
  } else if (event.key === "F2") {
    const el = nodesEl.querySelector(`[data-id="${state.selectedId}"] .node-text`);
    if (el) beginEdit(state.selectedId, el);
  }
});

centerIfNeeded();
render();
