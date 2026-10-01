const STORAGE_KEY = "mindmap.v2";
const MAP_VERSION = 4;

const COLORS = {
  gold: { fill: "#f3e3a0", stroke: "#e0c15a", ink: "#3a3420" },
  green: { fill: "#c6e6a4", stroke: "#7fbf4a", ink: "#243016" },
  cyan: { fill: "#b7ebe4", stroke: "#3eb8ac", ink: "#14332f" },
  blue: { fill: "#c5daf8", stroke: "#6aa2e0", ink: "#1a3050" },
  orange: { fill: "#f8d3b4", stroke: "#ee9a62", ink: "#4a2a16" },
  root: { fill: "#e4e4e4", stroke: "#b5b5b5", ink: "#2a2a2a" },
};

const viewport = document.getElementById("viewport");
const world = document.getElementById("world");
const edges = document.getElementById("edges");
const nodesEl = document.getElementById("nodes");

let state = loadState();
let drag = null;

function defaultStyle() {
  return { color: "color", line: "curve", nodes: "mixed", layout: "around" };
}

function withStyle(parsed) {
  const style = parsed.style || {};
  parsed.style = {
    color: style.color === "mono" ? "mono" : "color",
    line: style.line === "straight" || style.line === "elbow" ? style.line : "curve",
    nodes: ["filled", "outline", "text"].includes(style.nodes) ? style.nodes : "mixed",
    layout: ["horizontal", "vertical", "around", "mixed", "radial"].includes(style.layout) ? style.layout : "around",
  };
  return parsed;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw);
    if (!parsed.nodes || !parsed.nodes.root) return freshState();
    const styled = withStyle(parsed);
    if (styled.mapVersion !== MAP_VERSION) {
      styled.mapVersion = MAP_VERSION;
      styled.centered = false;
      relayoutNodes(styled.nodes, styled.style, "root", textWidth);
      return styled;
    }
    return styled;
  } catch {
    return freshState();
  }
}

function freshState() {
  const style = defaultStyle();
  const nodes = buildTreeNodes(PFLANZENSCHUTZ);
  relayoutNodes(nodes, style, "root", textWidth);
  return {
    panX: 0,
    panY: 0,
    zoom: 1,
    selectedId: "root",
    centered: false,
    nodes,
    style,
    mapVersion: MAP_VERSION,
  };
}

function textWidth(text, branch) {
  const canvas = textWidth.canvas || (textWidth.canvas = document.createElement("canvas"));
  const ctx = canvas.getContext("2d");
  ctx.font = `${branch ? "600 " : "500 "}13px "Segoe UI", "Helvetica Neue", sans-serif`;
  return ctx.measureText(text).width + (branch ? 22 : 6);
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
  return nodeList()
    .filter((node) => node.parentId === id)
    .sort((a, b) => a.order - b.order);
}

function applyTransform() {
  world.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
}

function centerIfNeeded() {
  if (state.centered) return;
  const rect = viewport.getBoundingClientRect();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodeList()) {
    const half = (node.w || 80) / 2;
    minX = Math.min(minX, node.x - half);
    maxX = Math.max(maxX, node.x + half);
    minY = Math.min(minY, node.y - 16);
    maxY = Math.max(maxY, node.y + 16);
  }
  const pad = 36;
  const zoom = Math.min(
    1.15,
    (rect.width - pad * 2) / Math.max(1, maxX - minX),
    (rect.height - pad * 2) / Math.max(1, maxY - minY),
  );
  state.zoom = Math.max(0.05, zoom);
  state.panX = rect.width / 2 - ((minX + maxX) / 2) * state.zoom;
  state.panY = rect.height / 2 - ((minY + maxY) / 2) * state.zoom;
  state.centered = true;
  saveState();
}

function render() {
  applyTransform();
  renderNodes();
  renderEdges();
  syncArrangementControl();
}

function renderNodes() {
  nodesEl.replaceChildren();
  for (const node of nodeList()) {
    const leaf = node.id !== "root" && childrenOf(node.id).length === 0;
    const look = nodeLook(node, leaf);
    const el = document.createElement("div");
    el.className = "node" + (leaf ? " leaf" : " branch");
    if (node.id === "root") el.classList.add("root");
    if (node.id === state.selectedId) el.classList.add("selected");
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
    el.style.color = look.ink;
    el.style.background = look.fill;
    el.style.borderColor = look.stroke;
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

function nodeLook(node, leaf) {
  const palette = COLORS[node.color] || COLORS.root;
  const mono = state.style.color === "mono";
  const ink = mono ? "#1c1917" : palette.ink;
  const stroke = mono ? "#2f2f2f" : palette.stroke;
  const fill = mono ? (node.id === "root" ? "#eceae6" : "#fffcf8") : palette.fill;
  const mode = state.style.nodes;
  const boxed = mode === "filled" || mode === "outline" || (mode === "mixed" && !leaf);
  const filled = mode === "filled" || (mode === "mixed" && !leaf);
  return {
    ink,
    stroke: boxed ? stroke : "transparent",
    fill: filled ? fill : boxed ? "#fffcf8" : "transparent",
  };
}

function nodeBox(node) {
  const el = nodesEl.querySelector(`[data-id="${node.id}"]`);
  const w = el ? el.offsetWidth : node.w || 48;
  const h = el ? el.offsetHeight : 22;
  return {
    left: node.x - w / 2,
    right: node.x + w / 2,
    top: node.y - h / 2,
    bottom: node.y + h / 2,
    cx: node.x,
    cy: node.y,
  };
}

function nodeDir(node, parent) {
  if (node.dir === "n" || node.dir === "e" || node.dir === "s" || node.dir === "w") return node.dir;
  const dx = node.x - parent.x;
  const dy = node.y - parent.y;
  if (Math.abs(dy) > Math.abs(dx)) return dy < 0 ? "n" : "s";
  return dx < 0 ? "w" : "e";
}

const OPPOSITE_DIR = { n: "s", s: "n", e: "w", w: "e" };
const RAY_DIR = [
  ["e", 0],
  ["n", Math.PI / 2],
  ["w", Math.PI],
  ["s", -Math.PI / 2],
];

function rayDir(node) {
  if (typeof node.ray !== "number") return null;
  const found = RAY_DIR.find(([, value]) => Math.abs(value - node.ray) < 0.001);
  return found ? found[0] : null;
}

function facePoint(box, face, toward) {
  const gap = 6;
  if (face === "n" || face === "s") {
    const limit = Math.max(0, (box.right - box.left) / 2 - 4);
    const x = Math.min(box.cx + limit, Math.max(box.cx - limit, toward.x));
    return { x, y: face === "n" ? box.top - gap : box.bottom + gap };
  }
  const limit = Math.max(0, (box.bottom - box.top) / 2 - 4);
  const y = Math.min(box.cy + limit, Math.max(box.cy - limit, toward.y));
  return { x: face === "w" ? box.left - gap : box.right + gap, y };
}

function edgePathFace(start, end, kind, face) {
  const vertical = face === "n" || face === "s";
  if (kind === "straight") return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  if (kind === "elbow") {
    if (vertical) {
      const midY = (start.y + end.y) / 2;
      return `M ${start.x} ${start.y} V ${midY} H ${end.x} V ${end.y}`;
    }
    const midX = (start.x + end.x) / 2;
    return `M ${start.x} ${start.y} H ${midX} V ${end.y} H ${end.x}`;
  }
  const delta = vertical ? end.y - start.y : end.x - start.x;
  const room = Math.abs(delta);
  if (room < 8) return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  const sign = Math.sign(delta) || 1;
  const pull = Math.min(room * 0.45, Math.max(0, room - 4));
  if (vertical) {
    return `M ${start.x} ${start.y} C ${start.x} ${start.y + sign * pull}, ${end.x} ${end.y - sign * pull}, ${end.x} ${end.y}`;
  }
  return `M ${start.x} ${start.y} C ${start.x + sign * pull} ${start.y}, ${end.x - sign * pull} ${end.y}, ${end.x} ${end.y}`;
}

function nodeAngle(node, parent) {
  if (typeof node.angle === "number" && Number.isFinite(node.angle)) return node.angle;
  const dir = nodeDir(node, parent);
  return { e: 0, n: Math.PI / 2, w: Math.PI, s: -Math.PI / 2 }[dir];
}

function borderPoint(box, angle) {
  const dx = Math.cos(angle);
  const dy = -Math.sin(angle);
  const tx = Math.abs(dx) < 1e-6 ? Infinity : ((dx > 0 ? box.right : box.left) - box.cx) / dx;
  const ty = Math.abs(dy) < 1e-6 ? Infinity : ((dy > 0 ? box.bottom : box.top) - box.cy) / dy;
  const distance = (Number.isFinite(Math.min(tx, ty)) ? Math.min(tx, ty) : 0) + 6;
  return { x: box.cx + dx * distance, y: box.cy + dy * distance };
}

function edgePath(start, end, kind, angle) {
  const dx = Math.cos(angle);
  const dy = -Math.sin(angle);
  const room = Math.hypot(end.x - start.x, end.y - start.y);
  if (kind === "straight" || room < 8) return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  if (kind === "elbow") {
    const midX = start.x + dx * room * 0.5;
    const midY = start.y + dy * room * 0.5;
    return `M ${start.x} ${start.y} L ${midX} ${midY} L ${end.x} ${end.y}`;
  }
  const pull = Math.min(room * 0.45, Math.max(0, room - 4));
  return `M ${start.x} ${start.y} C ${start.x + dx * pull} ${start.y + dy * pull}, ${end.x - dx * pull} ${end.y - dy * pull}, ${end.x} ${end.y}`;
}

function gutterPath(parent, child, kind, spine) {
  if (spine === "w" || spine === "e") {
    const beside = child.left > parent.right - 2 || child.right < parent.left + 2;
    if (beside) {
      const onRight = child.cx >= parent.cx;
      const startX = onRight ? parent.right : parent.left;
      const endX = onRight ? child.left : child.right;
      if (kind === "straight") return `M ${startX} ${parent.cy} L ${endX} ${child.cy}`;
      return `M ${startX} ${parent.cy} V ${child.cy} H ${endX}`;
    }
    const west = spine !== "e";
    const spineX = west ? Math.min(parent.left, child.left) - 8 : Math.max(parent.right, child.right) + 8;
    const startX = west ? parent.left : parent.right;
    const endX = west ? child.left : child.right;
    if (kind === "straight") return `M ${startX} ${parent.cy} L ${endX} ${child.cy}`;
    return `M ${startX} ${parent.cy} H ${spineX} V ${child.cy} H ${endX}`;
  }
  const onRight = child.cx >= parent.cx;
  const start = { x: onRight ? parent.right + 4 : parent.left - 4, y: parent.cy };
  const end = { x: onRight ? child.left - 4 : child.right + 4, y: child.cy };
  if ((onRight && end.x <= start.x) || (!onRight && end.x >= start.x)) {
    return `M ${parent.cx} ${parent.cy} L ${child.cx} ${child.cy}`;
  }
  if (kind === "straight" || Math.abs(end.y - start.y) < 8) return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  if (kind === "elbow") return `M ${start.x} ${start.y} V ${end.y} H ${end.x}`;
  const sign = Math.sign(end.y - start.y) || 1;
  const pull = Math.min(Math.abs(end.y - start.y) * 0.45, 36);
  return `M ${start.x} ${start.y} C ${start.x} ${start.y + sign * pull}, ${start.x} ${end.y}, ${end.x} ${end.y}`;
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
  const pad = 120;
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
    const face = rayDir(node);
    let start;
    let end;
    let pathData;
    if (node.gutter) {
      pathData = gutterPath(nodeBox(parent), nodeBox(node), state.style.line, node.spine);
    } else if (face) {
      start = facePoint(nodeBox(parent), face, node);
      end = facePoint(nodeBox(node), OPPOSITE_DIR[face], parent);
      pathData = edgePathFace(start, end, state.style.line, face);
    } else {
      const angle = nodeAngle(node, parent);
      start = borderPoint(nodeBox(parent), angle);
      end = borderPoint(nodeBox(node), angle + Math.PI);
      pathData = edgePath(start, end, state.style.line, angle);
    }
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    const palette = COLORS[node.color] || COLORS.root;
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", state.style.color === "mono" ? "#2f2f2f" : palette.stroke);
    path.setAttribute("stroke-width", "2.25");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
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
    x: parent.x,
    y: parent.y,
    order: siblings.length,
    dir: parent.dir || null,
    prefer: null,
    color: parent.color === "root" ? "gold" : parent.color,
    w: textWidth("Neu", false),
    h: 18,
  };
  state.selectedId = id;
  relayoutNodes(state.nodes, state.style, parentId, textWidth);
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
    const next = Math.min(2.4, Math.max(0.05, state.zoom * (event.deltaY < 0 ? 1.08 : 0.92)));
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

function shownFlow(node) {
  if (node && ["horizontal", "vertical", "around", "radial"].includes(node.flow)) return node.flow;
  if (node && !node.parentId) {
    const layout = state.style.layout;
    if (layout === "horizontal" || layout === "vertical" || layout === "around" || layout === "radial") return layout;
    return "around";
  }
  return "continue";
}

function syncArrangementControl() {
  const select = document.getElementById("style-layout");
  if (!select) return;
  const node = state.nodes[state.selectedId];
  const continueOption = select.querySelector('option[value="continue"]');
  if (continueOption) continueOption.hidden = !node || !node.parentId;
  select.value = shownFlow(node);
}

function clearDescendantFlows(id) {
  for (const child of childrenOf(id)) {
    delete child.flow;
    clearDescendantFlows(child.id);
  }
}

function applyArrangement(nodeId, flow) {
  const node = state.nodes[nodeId];
  if (!node) return;
  if (!node.parentId) {
    const layout = flow === "continue" ? "around" : flow;
    state.style.layout = layout;
    node.flow = layout;
  } else if (flow === "continue") {
    delete node.flow;
  } else {
    node.flow = flow;
  }
  clearDescendantFlows(node.id);
  relayoutNodes(state.nodes, state.style, node.id, textWidth);
  if (!node.parentId) {
    state.centered = false;
    centerIfNeeded();
  }
}

function syncStyleControls() {
  for (const [id, key] of [
    ["style-color", "color"],
    ["style-line", "line"],
    ["style-nodes", "nodes"],
  ]) {
    const control = document.getElementById(id);
    if (control) control.value = state.style[key];
  }
  syncArrangementControl();
}

for (const [id, key] of [
  ["style-color", "color"],
  ["style-line", "line"],
  ["style-nodes", "nodes"],
]) {
  const control = document.getElementById(id);
  control.value = state.style[key];
  control.addEventListener("change", () => {
    state.style[key] = control.value;
    saveState();
    render();
  });
}

document.getElementById("style-layout").addEventListener("change", () => {
  applyArrangement(state.selectedId || "root", document.getElementById("style-layout").value);
  saveState();
  render();
});

document.getElementById("relayout").addEventListener("click", () => {
  Mindmap.relayout(state.selectedId || "root");
});

document.getElementById("add-child").addEventListener("click", () => {
  addChild(state.selectedId || "root");
});

document.getElementById("delete-node").addEventListener("click", () => {
  deleteNode(state.selectedId);
});

document.getElementById("download-image").addEventListener("click", () => {
  downloadImage();
});

window.addEventListener("keydown", (event) => {
  const editing = document.querySelector(".node-text[contenteditable='true']");
  if (editing) return;
  if (window.MINDMAP_VIEWING) return;
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

function mindmapDocument() {
  return {
    version: 1,
    style: { ...state.style },
    camera: { panX: state.panX, panY: state.panY, zoom: state.zoom },
    nodes: JSON.parse(JSON.stringify(state.nodes)),
  };
}

function assertMindmapDocument(doc) {
  if (!doc || typeof doc !== "object" || !doc.nodes || !doc.nodes.root) {
    throw new Error("Mindmap-Dokument braucht nodes.root");
  }
  for (const node of Object.values(doc.nodes)) {
    if (!node || typeof node.id !== "string" || typeof node.text !== "string") {
      throw new Error("Jeder Knoten braucht id und text");
    }
    if (node.parentId && !doc.nodes[node.parentId]) {
      throw new Error(`Elternknoten fehlt: ${node.parentId} für ${node.id}`);
    }
  }
}

function contentBounds() {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodeList()) {
    const box = nodeBox(node);
    minX = Math.min(minX, box.left);
    maxX = Math.max(maxX, box.right);
    minY = Math.min(minY, box.top);
    maxY = Math.max(maxY, box.bottom);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 120, maxY: 48 };
  return { minX, minY, maxX, maxY };
}

function imageFileName() {
  const raw = (state.nodes.root && state.nodes.root.text) || "mindmap";
  const safe = raw
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${safe || "mindmap"}.png`;
}

function renderMapCanvas() {
  const bounds = contentBounds();
  const pad = 48;
  const cssW = Math.max(1, Math.ceil(bounds.maxX - bounds.minX + pad * 2));
  const cssH = Math.max(1, Math.ceil(bounds.maxY - bounds.minY + pad * 2));
  const scale = Math.max(1, Math.min(2, 8192 / cssW, 8192 / cssH));
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(cssW * scale);
  canvas.height = Math.ceil(cssH * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.translate(pad - bounds.minX, pad - bounds.minY);

  ctx.fillStyle = "#f6f3ee";
  ctx.fillRect(bounds.minX - pad, bounds.minY - pad, cssW, cssH);
  ctx.fillStyle = "rgba(28, 25, 23, 0.08)";
  const step = 22;
  const originX = bounds.minX - pad;
  const originY = bounds.minY - pad;
  for (let y = Math.ceil(originY / step) * step; y < originY + cssH; y += step) {
    for (let x = Math.ceil(originX / step) * step; x < originX + cssW; x += step) {
      ctx.fillRect(x, y, 1, 1);
    }
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const pathEl of edges.querySelectorAll("path")) {
    const d = pathEl.getAttribute("d");
    if (!d) continue;
    ctx.strokeStyle = pathEl.getAttribute("stroke") || "#2f2f2f";
    ctx.lineWidth = 2.25;
    ctx.stroke(new Path2D(d));
  }

  for (const node of nodeList()) {
    const leaf = node.id !== "root" && childrenOf(node.id).length === 0;
    const look = nodeLook(node, leaf);
    const box = nodeBox(node);
    const w = box.right - box.left;
    const h = box.bottom - box.top;
    const radius = Math.min(7, w / 2, h / 2);
    if (look.fill !== "transparent") {
      ctx.beginPath();
      ctx.roundRect(box.left, box.top, w, h, radius);
      ctx.fillStyle = look.fill;
      ctx.fill();
    }
    if (look.stroke !== "transparent") {
      ctx.beginPath();
      ctx.roundRect(box.left + 0.5, box.top + 0.5, Math.max(0, w - 1), Math.max(0, h - 1), radius);
      ctx.strokeStyle = look.stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle = look.ink;
    ctx.font = `${leaf ? "500" : "600"} 13px "Segoe UI", "Helvetica Neue", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(node.text, node.x, node.y);
  }

  return canvas;
}

function downloadImage() {
  const canvas = renderMapCanvas();
  const name = imageFileName();
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}

const Mindmap = {
  getDocument: mindmapDocument,
  downloadImage,
  setDocument(doc) {
    assertMindmapDocument(doc);
    state.nodes = JSON.parse(JSON.stringify(doc.nodes));
    state.style = withStyle({ style: doc.style || {} }).style;
    if (doc.camera) {
      state.panX = Number.isFinite(doc.camera.panX) ? doc.camera.panX : state.panX;
      state.panY = Number.isFinite(doc.camera.panY) ? doc.camera.panY : state.panY;
      state.zoom = Number.isFinite(doc.camera.zoom) ? doc.camera.zoom : state.zoom;
    }
    state.mapVersion = MAP_VERSION;
    syncStyleControls();
    saveState();
    render();
    return mindmapDocument();
  },
  relayout(nodeId) {
    relayoutNodes(state.nodes, state.style, nodeId || state.selectedId || "root", textWidth);
    saveState();
    render();
    return mindmapDocument();
  },
  setStyle(partial) {
    const next = withStyle({ style: { ...state.style, ...partial } }).style;
    const layoutChanged = next.layout !== state.style.layout;
    state.style = next;
    if (layoutChanged && state.nodes.root) {
      const layout = next.layout === "mixed" ? "around" : next.layout;
      state.nodes.root.flow = layout;
      clearDescendantFlows("root");
      relayoutNodes(state.nodes, state.style, "root", textWidth);
      state.centered = false;
      centerIfNeeded();
    }
    syncStyleControls();
    saveState();
    render();
    return { ...state.style };
  },
  getStyle() {
    return { ...state.style };
  },
};

window.Mindmap = Mindmap;

centerIfNeeded();
render();
