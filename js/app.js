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

const ANCHOR_HOVER_ZOOM = 0.8;
const ANCHOR_HOVER_PX = 18;

let state = loadState();
let drag = null;
let anchorEdgeId = null;
let hoverEdgeId = null;

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

// Automatisches Anordnen + ultimativer Anti-Collider (js/collider.js):
// garantiert, dass danach keine Knoten überlappen, keine Kante durch einen
// fremden Knoten läuft und keine Kanten sich kreuzen.
function relayoutCollided(nodes, style, anchorId) {
  const anchor = nodes[anchorId] || nodes.root;
  if (!anchor) return;
  relayoutNodes(nodes, style, anchorId, textWidth);
  if (typeof antiCollide === "function") antiCollide(nodes, style && style.line);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw);
    if (!parsed.nodes || !parsed.nodes.root) return freshState();
    const styled = withStyle(parsed);
    styled.scope = parsed.scope === "subtree" ? "subtree" : "node";
    styled.showAnchors = parsed.showAnchors !== false;
    if (styled.mapVersion !== MAP_VERSION) {
      styled.mapVersion = MAP_VERSION;
      styled.centered = false;
      relayoutCollided(styled.nodes, styled.style, "root");
    }
    return styled;
  } catch {
    return freshState();
  }
}

function freshState() {
  const style = defaultStyle();
  const nodes = buildTreeNodes(PFLANZENSCHUTZ);
  relayoutCollided(nodes, style, "root");
  return {
    panX: 0,
    panY: 0,
    zoom: 1,
    selectedId: "root",
    centered: false,
    nodes,
    style,
    scope: "node",
    showAnchors: true,
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
  renderPorts();
  syncStyleControls();
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
      event.preventDefault();
      event.stopPropagation();
      drag = null;
      beginEdit(node.id, text);
    });
    nodesEl.append(el);
  }
}

function effectiveColorMode(node) {
  return node && (node.colorMode === "mono" || node.colorMode === "color") ? node.colorMode : state.style.color;
}

function effectiveLine(node) {
  return node && (node.line === "curve" || node.line === "straight" || node.line === "elbow") ? node.line : state.style.line;
}

function effectiveLook(node) {
  return node && ["mixed", "filled", "outline", "text"].includes(node.look) ? node.look : state.style.nodes;
}

function nodeLook(node, leaf) {
  const palette = COLORS[node.color] || COLORS.root;
  const mono = effectiveColorMode(node) === "mono";
  const ink = mono ? "#1c1917" : palette.ink;
  const stroke = mono ? "#2f2f2f" : palette.stroke;
  const fill = mono ? (node.id === "root" ? "#eceae6" : "#fffcf8") : palette.fill;
  const mode = effectiveLook(node);
  const boxed = mode === "filled" || mode === "outline" || (mode === "mixed" && !leaf);
  const filled = mode === "filled" || (mode === "mixed" && !leaf);
  return {
    ink,
    stroke: boxed ? stroke : "transparent",
    fill: filled ? fill : boxed ? "#fffcf8" : "transparent",
  };
}

function syncNodeSizes() {
  for (const node of nodeList()) {
    const el = nodesEl.querySelector(`[data-id="${node.id}"]`);
    if (!el) continue;
    node.w = el.offsetWidth;
    node.h = el.offsetHeight;
  }
}

function nodeBox(node) {
  // Rein aus den Layout-Maßen (node.w/node.h enthalten bereits Padding+Rahmen
  // über textWidth) — deterministisch, auch vor dem ersten Rendern und damit
  // identisch zur Sicht des Anti-Colliders.
  const w = node.w || 48;
  const h = node.h || 22;
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
  const line = (d, end) => ({ d, end });
  if (spine === "w" || spine === "e") {
    const beside = child.left > parent.right - 2 || child.right < parent.left + 2;
    if (beside) {
      const onRight = child.cx >= parent.cx;
      const startX = onRight ? parent.right : parent.left;
      const endX = onRight ? child.left : child.right;
      const end = { x: endX, y: child.cy };
      if (kind === "straight") return line(`M ${startX} ${parent.cy} L ${endX} ${child.cy}`, end);
      return line(`M ${startX} ${parent.cy} V ${child.cy} H ${endX}`, end);
    }
    const west = spine !== "e";
    const spineX = west ? Math.min(parent.left, child.left) - 8 : Math.max(parent.right, child.right) + 8;
    const startX = west ? parent.left : parent.right;
    const endX = west ? child.left : child.right;
    const end = { x: endX, y: child.cy };
    if (kind === "straight") return line(`M ${startX} ${parent.cy} L ${endX} ${child.cy}`, end);
    return line(`M ${startX} ${parent.cy} H ${spineX} V ${child.cy} H ${endX}`, end);
  }
  const onRight = child.cx >= parent.cx;
  const start = { x: onRight ? parent.right + 4 : parent.left - 4, y: parent.cy };
  const end = { x: onRight ? child.left - 4 : child.right + 4, y: child.cy };
  if ((onRight && end.x <= start.x) || (!onRight && end.x >= start.x)) {
    return line(`M ${parent.cx} ${parent.cy} L ${child.cx} ${child.cy}`, { x: child.cx, y: child.cy });
  }
  if (kind === "straight" || Math.abs(end.y - start.y) < 8) return line(`M ${start.x} ${start.y} L ${end.x} ${end.y}`, end);
  if (kind === "elbow") return line(`M ${start.x} ${start.y} V ${end.y} H ${end.x}`, end);
  const sign = Math.sign(end.y - start.y) || 1;
  const pull = Math.min(Math.abs(end.y - start.y) * 0.45, 36);
  return line(
    `M ${start.x} ${start.y} C ${start.x} ${start.y + sign * pull}, ${start.x} ${end.y}, ${end.x} ${end.y}`,
    end,
  );
}

const PORT_NORMAL = { e: 0, n: Math.PI / 2, w: Math.PI, s: -Math.PI / 2 };

function isPort(port) {
  return (
    !!port &&
    (port.side === "n" || port.side === "e" || port.side === "s" || port.side === "w") &&
    typeof port.t === "number" &&
    Number.isFinite(port.t)
  );
}

function portPoint(box, port) {
  const t = Math.min(1, Math.max(0, port.t));
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  if (port.side === "n") return { x: box.left + t * width, y: box.top };
  if (port.side === "s") return { x: box.left + t * width, y: box.bottom };
  if (port.side === "w") return { x: box.left, y: box.top + t * height };
  return { x: box.right, y: box.top + t * height };
}

function nearestBorderPort(box, x, y) {
  const width = Math.max(1, box.right - box.left);
  const height = Math.max(1, box.bottom - box.top);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const xOn = clamp(x, box.left, box.right);
  const yOn = clamp(y, box.top, box.bottom);
  const candidates = [
    { side: "n", x: xOn, y: box.top, t: (xOn - box.left) / width },
    { side: "e", x: box.right, y: yOn, t: (yOn - box.top) / height },
    { side: "s", x: xOn, y: box.bottom, t: (xOn - box.left) / width },
    { side: "w", x: box.left, y: yOn, t: (yOn - box.top) / height },
  ];
  let best = candidates[0];
  let bestDist = Infinity;
  for (const candidate of candidates) {
    const dist = (candidate.x - x) ** 2 + (candidate.y - y) ** 2;
    if (dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }
  return { side: best.side, t: Math.min(1, Math.max(0, best.t)) };
}

function gutterStart(parent, child, spine) {
  if (spine === "w" || spine === "e") {
    const beside = child.left > parent.right - 2 || child.right < parent.left + 2;
    if (beside) {
      const onRight = child.cx >= parent.cx;
      return { x: onRight ? parent.right : parent.left, y: parent.cy };
    }
    const west = spine !== "e";
    return { x: west ? parent.left : parent.right, y: parent.cy };
  }
  const onRight = child.cx >= parent.cx;
  return { x: onRight ? parent.right + 4 : parent.left - 4, y: parent.cy };
}

function classicEdge(parent, node, parentBox, childBox, kind) {
  const face = rayDir(node);
  if (node.gutter) {
    const gutter = gutterPath(parentBox, childBox, kind, node.spine);
    return { start: gutterStart(parentBox, childBox, node.spine), end: gutter.end, d: gutter.d };
  }
  if (face) {
    const start = facePoint(parentBox, face, node);
    const end = facePoint(childBox, OPPOSITE_DIR[face], parent);
    return { start, end, d: edgePathFace(start, end, kind, face) };
  }
  const angle = nodeAngle(node, parent);
  const start = borderPoint(parentBox, angle);
  const end = borderPoint(childBox, angle + Math.PI);
  return { start, end, d: edgePath(start, end, kind, angle) };
}

function evenMapFor(parent) {
  if (shownFlow(parent) !== "around") return {};
  const box = nodeBox(parent);
  return evenBorderPorts(
    {
      x: parent.x,
      y: parent.y,
      w: Math.max(1, box.right - box.left),
      h: Math.max(1, box.bottom - box.top),
    },
    childrenOf(parent.id),
  );
}

function pointInRect(x, y, rect) {
  return x > rect.left && x < rect.right && y > rect.top && y < rect.bottom;
}

function shrinkRect(rect, amount) {
  return {
    left: rect.left + amount,
    right: rect.right - amount,
    top: rect.top + amount,
    bottom: rect.bottom - amount,
  };
}

function samplePath(d) {
  const tokens = d.match(/[MLHVCSQTAZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  if (!tokens) return [];
  const points = [];
  const stepsFor = (distance) => Math.max(4, Math.ceil(distance / 4));
  let i = 0;
  let x = 0;
  let y = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === "M") {
      x = num();
      y = num();
      points.push({ x, y });
    } else if (cmd === "L") {
      const nx = num();
      const ny = num();
      const steps = stepsFor(Math.hypot(nx - x, ny - y));
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        points.push({ x: x + (nx - x) * t, y: y + (ny - y) * t });
      }
      x = nx;
      y = ny;
    } else if (cmd === "H") {
      const nx = num();
      const steps = stepsFor(Math.abs(nx - x));
      for (let step = 1; step <= steps; step += 1) points.push({ x: x + (nx - x) * (step / steps), y });
      x = nx;
    } else if (cmd === "V") {
      const ny = num();
      const steps = stepsFor(Math.abs(ny - y));
      for (let step = 1; step <= steps; step += 1) points.push({ x, y: y + (ny - y) * (step / steps) });
      y = ny;
    } else if (cmd === "C") {
      const x1 = num();
      const y1 = num();
      const x2 = num();
      const y2 = num();
      const nx = num();
      const ny = num();
      const steps = stepsFor(Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(nx - x2, ny - y2));
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        const u = 1 - t;
        points.push({
          x: u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * nx,
          y: u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ny,
        });
      }
      x = nx;
      y = ny;
    } else break;
  }
  return points;
}

function obstacleRects(skip) {
  const pad = 3;
  const rects = [];
  for (const node of nodeList()) {
    if (skip.has(node.id)) continue;
    const box = nodeBox(node);
    rects.push({
      left: box.left - pad,
      right: box.right + pad,
      top: box.top - pad,
      bottom: box.bottom + pad,
    });
  }
  return rects;
}

function pathHits(d, rects, start, end) {
  return samplePath(d).some((point) => {
    if (start && Math.hypot(point.x - start.x, point.y - start.y) < 2) return false;
    if (end && Math.hypot(point.x - end.x, point.y - end.y) < 2) return false;
    return rects.some((rect) => pointInRect(point.x, point.y, rect));
  });
}

function legBlocked(from, to, rects) {
  return rects.some((rect) => {
    const inner = shrinkRect(rect, 1);
    const target = inner.right - inner.left < 2 || inner.bottom - inner.top < 2 ? rect : inner;
    return segmentHitsRect(from.x, from.y, to.x, to.y, target);
  });
}

function ownRects(ids) {
  const rects = [];
  for (const id of ids) {
    const node = state.nodes[id];
    if (!node) continue;
    const box = nodeBox(node);
    rects.push({ left: box.left, right: box.right, top: box.top, bottom: box.bottom });
  }
  return rects;
}

function shortestAround(start, end, rects) {
  const verts = [start, end];
  for (const rect of rects) {
    verts.push(
      { x: rect.left, y: rect.top },
      { x: rect.right, y: rect.top },
      { x: rect.right, y: rect.bottom },
      { x: rect.left, y: rect.bottom },
    );
  }
  const count = verts.length;
  const dist = Array(count).fill(Infinity);
  const prev = Array(count).fill(-1);
  const used = Array(count).fill(false);
  dist[0] = 0;
  for (let iter = 0; iter < count; iter += 1) {
    let best = -1;
    for (let index = 0; index < count; index += 1) {
      if (!used[index] && (best < 0 || dist[index] < dist[best])) best = index;
    }
    if (best < 0 || !Number.isFinite(dist[best])) break;
    used[best] = true;
    if (best === 1) break;
    for (let index = 0; index < count; index += 1) {
      if (used[index] || legBlocked(verts[best], verts[index], rects)) continue;
      const alt = dist[best] + Math.hypot(verts[index].x - verts[best].x, verts[index].y - verts[best].y);
      if (alt < dist[index]) {
        dist[index] = alt;
        prev[index] = best;
      }
    }
  }
  if (!Number.isFinite(dist[1])) return null;
  const route = [];
  for (let index = 1; index !== -1; index = prev[index]) route.push(verts[index]);
  route.reverse();
  return route;
}

function expandRect(rect, amount) {
  return {
    left: rect.left - amount,
    right: rect.right + amount,
    top: rect.top - amount,
    bottom: rect.bottom + amount,
  };
}

function exitPoint(point, rect) {
  const gap = 8;
  const sides = [
    { d: Math.abs(point.x - rect.left), p: { x: rect.left - gap, y: point.y } },
    { d: Math.abs(point.x - rect.right), p: { x: rect.right + gap, y: point.y } },
    { d: Math.abs(point.y - rect.top), p: { x: point.x, y: rect.top - gap } },
    { d: Math.abs(point.y - rect.bottom), p: { x: point.x, y: rect.bottom + gap } },
  ];
  sides.sort((a, b) => a.d - b.d);
  return sides[0].p;
}

function routeClear(start, end, direct, skip) {
  if (!start || !end) return direct;
  const foreign = obstacleRects(skip);
  const ownFull = ownRects(skip);
  const lead = [start];
  const tail = [end];
  let from = start;
  let to = end;
  const ownPad = [];
  for (const rect of ownFull) {
    const inner = shrinkRect(rect, 1);
    if (inner.right - inner.left < 2 || inner.bottom - inner.top < 2) continue;
    if (!segmentHitsRect(start.x, start.y, end.x, end.y, inner)) continue;
    const midX = (rect.left + rect.right) / 2;
    const midY = (rect.top + rect.bottom) / 2;
    const nearerStart = Math.hypot(start.x - midX, start.y - midY) <= Math.hypot(end.x - midX, end.y - midY);
    if (nearerStart) {
      from = exitPoint(start, rect);
      lead.push(from);
    } else {
      to = exitPoint(end, rect);
      tail.unshift(to);
    }
    ownPad.push(expandRect(rect, 3));
  }
  const obstacles = foreign.concat(ownPad);
  if (!ownPad.length && !legBlocked(start, end, obstacles) && !pathHits(direct, foreign, start, end)) return direct;
  if (!ownPad.length && !legBlocked(start, end, obstacles)) return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  let active = obstacles.filter((rect) => segmentHitsRect(from.x, from.y, to.x, to.y, rect));
  if (!active.length) active = ownPad.length ? ownPad.slice() : obstacles.slice();
  const finish = (route) => {
    const points = lead.slice();
    for (const point of route.concat(tail)) {
      const prev = points[points.length - 1];
      if (Math.hypot(prev.x - point.x, prev.y - point.y) < 0.5) continue;
      points.push(point);
    }
    return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const route = shortestAround(from, to, active);
    if (!route) break;
    let added = false;
    for (const rect of obstacles) {
      if (active.includes(rect)) continue;
      const crossed = route.some(
        (point, index) => index > 0 && segmentHitsRect(route[index - 1].x, route[index - 1].y, point.x, point.y, rect),
      );
      if (crossed) {
        active.push(rect);
        added = true;
      }
    }
    if (!added) return finish(route);
  }
  const route = shortestAround(from, to, active);
  if (!route) return direct;
  return finish(route);
}

function outgoingGeometry(parent, node, evenMap) {
  const parentBox = nodeBox(parent);
  const childBox = nodeBox(node);
  const kind = effectiveLine(parent);
  const port = isPort(node.port) ? node.port : evenMap[node.id];
  let geo;
  if (port) {
    const start = portPoint(parentBox, port);
    const end = borderPoint(childBox, Math.atan2(-(start.y - childBox.cy), start.x - childBox.cx));
    geo = { start, end, d: edgePath(start, end, kind, PORT_NORMAL[port.side]) };
  } else geo = classicEdge(parent, node, parentBox, childBox, kind);
  geo.d = routeClear(geo.start, geo.end, geo.d, new Set([parent.id, node.id]));
  return geo;
}

// Kante genau so berechnen, wie sie gezeichnet wird — eine einzige Quelle
// für renderEdges UND den Anti-Collider (js/collider.js).
function computeEdgePath(nodes, node, parent) {
  return outgoingGeometry(parent, node, evenMapFor(parent)).d;
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
  const evenCache = new Map();
  for (const node of nodeList()) {
    if (!node.parentId) continue;
    const parent = state.nodes[node.parentId];
    if (!parent) continue;
    if (!evenCache.has(parent.id)) evenCache.set(parent.id, evenMapFor(parent));
    const geo = outgoingGeometry(parent, node, evenCache.get(parent.id));
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", geo.d);
    const palette = COLORS[node.color] || COLORS.root;
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", effectiveColorMode(parent) === "mono" ? "#2f2f2f" : palette.stroke);
    path.setAttribute("stroke-width", "2.25");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.style.pointerEvents = "none";
    fragment.append(path);
    if (!geo.start) continue;
    const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
    hit.setAttribute("d", geo.d);
    hit.setAttribute("fill", "none");
    hit.setAttribute("stroke", "transparent");
    hit.setAttribute("stroke-width", String(18 / Math.max(state.zoom, 0.05)));
    hit.setAttribute("stroke-linecap", "round");
    hit.dataset.edge = node.id;
    hit.classList.add("edge-hit");
    hit.style.pointerEvents = "stroke";
    hit.addEventListener("pointerdown", onEdgePointerDown);
    fragment.append(hit);
  }
  edges.replaceChildren(fragment);
}

function anchorVisible(childId) {
  const child = state.nodes[childId];
  if (!child || !child.parentId) return false;
  if (state.showAnchors !== false && child.parentId === state.selectedId) return true;
  if (childId === anchorEdgeId) return true;
  return childId === hoverEdgeId && state.zoom >= ANCHOR_HOVER_ZOOM;
}

function renderPorts() {
  const layer = document.getElementById("ports");
  if (!layer) return;
  layer.replaceChildren();
  const evenCache = new Map();
  for (const node of nodeList()) {
    if (!anchorVisible(node.id)) continue;
    const parent = state.nodes[node.parentId];
    if (!parent) continue;
    if (!evenCache.has(parent.id)) evenCache.set(parent.id, evenMapFor(parent));
    const geo = outgoingGeometry(parent, node, evenCache.get(parent.id));
    if (!geo.start) continue;
    const handle = document.createElement("div");
    handle.className = "port";
    handle.dataset.port = node.id;
    handle.title = "Linie am Rand verschieben";
    handle.style.left = `${geo.start.x}px`;
    handle.style.top = `${geo.start.y}px`;
    handle.addEventListener("pointerdown", (event) => onPortPointerDown(event, node.id));
    layer.append(handle);
  }
}

function anchorUnderPointer(clientX, clientY) {
  if (state.zoom < ANCHOR_HOVER_ZOOM) return null;
  const world = clientToWorld(clientX, clientY);
  const limit = ANCHOR_HOVER_PX / state.zoom;
  let best = null;
  let bestDist = limit;
  const evenCache = new Map();
  for (const node of nodeList()) {
    if (!node.parentId) continue;
    const parent = state.nodes[node.parentId];
    if (!parent) continue;
    if (!evenCache.has(parent.id)) evenCache.set(parent.id, evenMapFor(parent));
    const geo = outgoingGeometry(parent, node, evenCache.get(parent.id));
    if (!geo.start) continue;
    const dist = Math.hypot(geo.start.x - world.x, geo.start.y - world.y);
    if (dist <= bestDist) {
      best = node.id;
      bestDist = dist;
    }
  }
  return best;
}

function updateAnchorHover(clientX, clientY) {
  const next = anchorUnderPointer(clientX, clientY);
  if (next === hoverEdgeId) return;
  hoverEdgeId = next;
  renderPorts();
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
  if (parent.colorMode) state.nodes[id].colorMode = parent.colorMode;
  if (parent.line) state.nodes[id].line = parent.line;
  if (parent.look) state.nodes[id].look = parent.look;
  if (Number.isFinite(parent.reach)) state.nodes[id].reach = parent.reach;
  state.selectedId = id;
  relayoutOutgoing(state.nodes, parentId, state.style, textWidth);
  if (typeof antiCollide === "function") antiCollide(state.nodes, state.style.line);
  saveState();
  render();
  const text = nodesEl.querySelector(`[data-id="${id}"] .node-text`);
  if (text) beginEdit(id, text);
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
  if (drop.has(anchorEdgeId)) anchorEdgeId = null;
  if (drop.has(hoverEdgeId)) hoverEdgeId = null;
  state.selectedId = state.nodes[state.selectedId] ? state.selectedId : "root";
  if (drop.has(state.selectedId)) state.selectedId = "root";
  saveState();
  render();
}

function selectAllText(textEl) {
  if (!textEl) return;
  textEl.focus();
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(textEl);
  selection.removeAllRanges();
  selection.addRange(range);
}

function beginEdit(id, textEl) {
  const node = state.nodes[id];
  if (!node || !textEl) return;
  const card = textEl.parentElement;
  if (textEl.isContentEditable) {
    selectAllText(textEl);
    const again = requestAnimationFrame(() => selectAllText(textEl));
    textEl.addEventListener("keydown", () => cancelAnimationFrame(again), { once: true });
    return;
  }
  card.classList.add("editing");
  textEl.contentEditable = "true";
  selectAllText(textEl);
  const again = requestAnimationFrame(() => selectAllText(textEl));
  textEl.addEventListener("keydown", () => cancelAnimationFrame(again), { once: true });

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
  if (event.detail >= 2) {
    event.preventDefault();
    drag = null;
    const text = event.currentTarget.querySelector(".node-text");
    if (text) beginEdit(id, text);
    return;
  }
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
  for (const el of nodesEl.querySelectorAll(".node.selected")) el.classList.remove("selected");
  event.currentTarget.classList.add("selected");
  syncStyleControls();
  renderPorts();
  event.currentTarget.setPointerCapture(event.pointerId);
}

viewport.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  if (event.target.closest(".node, .port, .edge-hit")) return;
  if (anchorEdgeId) {
    anchorEdgeId = null;
    renderPorts();
  }
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
  if (!drag || event.pointerId !== drag.pointerId) {
    if (!drag) updateAnchorHover(event.clientX, event.clientY);
    return;
  }
  if (drag.kind === "pan") {
    state.panX = drag.panX + (event.clientX - drag.originX);
    state.panY = drag.panY + (event.clientY - drag.originY);
    applyTransform();
    return;
  }
  if (drag.kind === "port") {
    const parent = state.nodes[drag.parentId];
    const child = state.nodes[drag.childId];
    if (!parent || !child) return;
    const worldPoint = clientToWorld(event.clientX, event.clientY);
    child.port = nearestBorderPort(nodeBox(parent), worldPoint.x, worldPoint.y);
    renderEdges();
    const handle = document.querySelector(`[data-port="${child.id}"]`);
    if (handle) {
      const point = portPoint(nodeBox(parent), child.port);
      handle.style.left = `${point.x}px`;
      handle.style.top = `${point.y}px`;
    }
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
  renderPorts();
});

function clientToWorld(clientX, clientY) {
  const rect = viewport.getBoundingClientRect();
  return {
    x: (clientX - rect.left - state.panX) / state.zoom,
    y: (clientY - rect.top - state.panY) / state.zoom,
  };
}

function onEdgePointerDown(event) {
  if (event.button !== 0) return;
  const childId = event.currentTarget.dataset.edge;
  if (!state.nodes[childId]) return;
  event.preventDefault();
  event.stopPropagation();
  anchorEdgeId = childId;
  renderPorts();
}

function onPortPointerDown(event, childId) {
  if (event.button !== 0) return;
  const child = state.nodes[childId];
  if (!child || !child.parentId) return;
  event.preventDefault();
  event.stopPropagation();
  anchorEdgeId = childId;
  drag = {
    kind: "port",
    childId,
    parentId: child.parentId,
    pointerId: event.pointerId,
  };
  event.currentTarget.classList.add("dragging");
  event.currentTarget.setPointerCapture(event.pointerId);
}

window.addEventListener("pointerup", (event) => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (drag.kind === "port") {
    const handle = document.querySelector(`[data-port="${drag.childId}"]`);
    if (handle) handle.classList.remove("dragging");
  }
  const movedNode = drag.kind === "node";
  const shifted = movedNode && Math.hypot(event.clientX - drag.originX, event.clientY - drag.originY) > 4;
  viewport.classList.remove("panning");
  drag = null;
  if (shifted) {
    syncNodeSizes();
    clearCrossings(state.nodes);
    render();
  }
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
    if (state.zoom < ANCHOR_HOVER_ZOOM && hoverEdgeId) {
      hoverEdgeId = null;
      renderPorts();
    }
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
  const next = shownFlow(node);
  if (select.value !== next) select.value = next;
  const frame = document.getElementById("selected-name");
  if (!frame) return;
  const name = node && node.text ? node.text : "Keiner";
  frame.textContent = name;
  frame.title = name;
}

function scopedNodes(id) {
  const node = state.nodes[id];
  if (!node) return [];
  if (state.scope !== "subtree") return [node];
  const list = [];
  const walk = (nodeId) => {
    const current = state.nodes[nodeId];
    if (!current) return;
    list.push(current);
    for (const child of childrenOf(nodeId)) walk(child.id);
  };
  walk(id);
  return list;
}

function clearDescendantFlows(id) {
  for (const child of childrenOf(id)) {
    delete child.flow;
    clearDescendantFlows(child.id);
  }
}

function setNodeFlow(node, flow) {
  if (!node.parentId) {
    const layout = flow === "continue" ? "around" : flow;
    state.style.layout = layout;
    node.flow = layout;
    return;
  }
  if (flow === "continue") delete node.flow;
  else node.flow = flow;
}

function applyStyleKey(nodeId, key, value) {
  const field = { color: "colorMode", line: "line", nodes: "look" }[key];
  if (!field) return;
  for (const node of scopedNodes(nodeId)) node[field] = value;
}

function applyReachSetting(nodeId, reach) {
  const node = state.nodes[nodeId];
  if (!node || !Number.isFinite(reach)) return;
  const value = Math.min(160, Math.max(0, reach));
  for (const target of scopedNodes(nodeId)) target.reach = value;
  if (state.scope === "subtree") relayoutNodes(state.nodes, state.style, node.id, textWidth);
  else relayoutOutgoing(state.nodes, node.id, state.style, textWidth);
}

function applyArrangement(nodeId, flow) {
  const node = state.nodes[nodeId];
  if (!node) return;
  for (const target of scopedNodes(nodeId)) setNodeFlow(target, flow);
  if (state.scope === "subtree") relayoutCollided(state.nodes, state.style, node.id);
  else {
    relayoutOutgoing(state.nodes, node.id, state.style, textWidth);
    if (typeof antiCollide === "function") antiCollide(state.nodes, state.style.line);
  }
  if (!node.parentId) {
    state.centered = false;
    centerIfNeeded();
  }
}

function syncStyleControls() {
  const node = state.nodes[state.selectedId];
  const values = {
    "style-color": effectiveColorMode(node),
    "style-line": effectiveLine(node),
    "style-reach": String(layoutReach(node)),
    "style-nodes": effectiveLook(node),
    "style-scope": state.scope === "subtree" ? "subtree" : "node",
  };
  for (const [id, value] of Object.entries(values)) {
    const control = document.getElementById(id);
    if (control && control.value !== value) control.value = value;
  }
  const anchors = document.getElementById("show-anchors");
  if (anchors) anchors.checked = state.showAnchors !== false;
  syncArrangementControl();
}

const styleTarget = {};
for (const [id, key] of [
  ["style-color", "color"],
  ["style-line", "line"],
  ["style-nodes", "nodes"],
]) {
  const control = document.getElementById(id);
  control.addEventListener("pointerdown", () => {
    styleTarget[key] = state.selectedId || "root";
  });
  control.addEventListener("change", () => {
    const targetId = styleTarget[key] || state.selectedId || "root";
    styleTarget[key] = null;
    applyStyleKey(targetId, key, control.value);
    if (key === "line" && typeof antiCollide === "function") antiCollide(state.nodes, state.style.line);
    saveState();
    render();
  });
}

let reachTargetId = null;
const reachInput = document.getElementById("style-reach");
reachInput.addEventListener("pointerdown", () => {
  reachTargetId = state.selectedId || "root";
});
reachInput.addEventListener("input", () => {
  const targetId = reachTargetId || state.selectedId || "root";
  applyReachSetting(targetId, Number(reachInput.value));
  saveState();
  render();
});
reachInput.addEventListener("change", () => {
  reachTargetId = null;
});

document.getElementById("show-anchors").addEventListener("change", (event) => {
  state.showAnchors = event.target.checked;
  saveState();
  renderPorts();
});

document.getElementById("style-scope").addEventListener("change", (event) => {
  state.scope = event.target.value === "subtree" ? "subtree" : "node";
  saveState();
});

let arrangementTargetId = null;
const layoutSelect = document.getElementById("style-layout");
layoutSelect.addEventListener("pointerdown", () => {
  arrangementTargetId = state.selectedId || "root";
});
layoutSelect.addEventListener("change", () => {
  const id = arrangementTargetId || state.selectedId || "root";
  arrangementTargetId = null;
  applyArrangement(id, layoutSelect.value);
  saveState();
  render();
});

document.getElementById("relayout").addEventListener("click", () => {
  Mindmap.relayout(state.selectedId || "root", { deep: false });
});

document.getElementById("add-child").addEventListener("click", () => {
  addChild(state.selectedId || "root");
});

document.getElementById("delete-node").addEventListener("click", () => {
  deleteNode(state.selectedId);
});

function closeDownloadMenu() {
  const menu = document.getElementById("download-menu");
  const toggle = document.getElementById("download-toggle");
  if (menu) menu.hidden = true;
  if (toggle) toggle.setAttribute("aria-expanded", "false");
}

const downloadToggle = document.getElementById("download-toggle");
const downloadMenu = document.getElementById("download-menu");
if (downloadToggle && downloadMenu) {
  downloadToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = downloadMenu.hidden;
    downloadMenu.hidden = !open;
    downloadToggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
  document.addEventListener("click", (event) => {
    if (!downloadToggle.parentElement.contains(event.target)) closeDownloadMenu();
  });
}

const downloadImageButton = document.getElementById("download-image");
if (downloadImageButton) {
  downloadImageButton.addEventListener("click", () => {
    closeDownloadMenu();
    downloadImage();
  });
}

const downloadPdfButton = document.getElementById("download-pdf");
if (downloadPdfButton) {
  downloadPdfButton.addEventListener("click", () => {
    closeDownloadMenu();
    downloadPdf();
  });
}

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
  } else if (event.key === "Escape") {
    closeDownloadMenu();
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

function exportFileName(ext) {
  const raw = (state.nodes.root && state.nodes.root.text) || "mindmap";
  const safe = raw
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${safe || "mindmap"}.${ext}`;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function bytesFromString(text) {
  return new TextEncoder().encode(text);
}

function concatBytes(chunks) {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function pdfFromJpeg(jpeg, width, height) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const content = bytesFromString(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q\n`);
  const objects = [
    bytesFromString("<< /Type /Catalog /Pages 2 0 R >>"),
    bytesFromString("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    bytesFromString(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`),
    concatBytes([
      bytesFromString(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),
      jpeg,
      bytesFromString("\nendstream"),
    ]),
    concatBytes([
      bytesFromString(`<< /Length ${content.length} >>\nstream\n`),
      content,
      bytesFromString("\nendstream"),
    ]),
  ];
  const parts = [bytesFromString("%PDF-1.4\n%\x80\x81\x82\x83\n")];
  const offsets = [0];
  let pos = parts[0].length;
  objects.forEach((body, index) => {
    offsets[index + 1] = pos;
    const head = bytesFromString(`${index + 1} 0 obj\n`);
    const tail = bytesFromString("\nendobj\n");
    parts.push(head, body, tail);
    pos += head.length + body.length + tail.length;
  });
  const xrefStart = pos;
  let xref = "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  parts.push(bytesFromString(xref));
  parts.push(bytesFromString(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`));
  return concatBytes(parts);
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
    if (pathEl.dataset.edge) continue;
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
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, exportFileName("png"));
  }, "image/png");
}

function downloadPdf() {
  const canvas = renderMapCanvas();
  canvas.toBlob((blob) => {
    if (!blob) return;
    blob.arrayBuffer().then((buffer) => {
      const pdf = pdfFromJpeg(new Uint8Array(buffer), canvas.width, canvas.height);
      downloadBlob(new Blob([pdf], { type: "application/pdf" }), exportFileName("pdf"));
    });
  }, "image/jpeg", 0.92);
}

const Mindmap = {
  getDocument: mindmapDocument,
  downloadImage,
  downloadPdf,
  setDocument(doc) {
    assertMindmapDocument(doc);
    state.nodes = JSON.parse(JSON.stringify(doc.nodes));
    state.style = withStyle({ style: doc.style || {} }).style;
    // Auswahl zurücksetzen: die alte selectedId gehört meist zum vorherigen
    // Dokument und existiert im neuen nicht (z. B. Galerie-Kopie).
    state.selectedId = "root";
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
  relayout(nodeId, options) {
    const id = nodeId || state.selectedId || "root";
    if (!options || options.deep) relayoutCollided(state.nodes, state.style, id);
    else {
      relayoutOutgoing(state.nodes, id, state.style, textWidth);
      if (typeof antiCollide === "function") antiCollide(state.nodes, state.style.line);
    }
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
      relayoutCollided(state.nodes, state.style, "root");
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
syncNodeSizes();
{
  const before = JSON.stringify(Object.values(state.nodes).map((node) => [node.x, node.y]));
  clearCrossings(state.nodes);
  if (before !== JSON.stringify(Object.values(state.nodes).map((node) => [node.x, node.y]))) {
    render();
    saveState();
  }
}
