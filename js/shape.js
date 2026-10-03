// Knotenform und Kantenschnitt.
// Eine Form muss nur shapeContains können. Neue Formen (Ellipse, Raute, …)
// ergänzen den Schalter dort; die Kanten bleiben unverändert.
// Der Radius entspricht border-radius der Knoten in css/app.css.

const NODE_OUTLINE_RADIUS = 7;
const NODE_SHAPES = new Set(["round", "rect", "pill", "ellipse", "diamond"]);

function nodeShape(node) {
  const w = Math.max(1, node && node.w ? node.w : 48);
  const h = Math.max(1, node && node.h ? node.h : 22);
  const chosen = node && NODE_SHAPES.has(node.shape) ? node.shape : null;
  const fallback = typeof state !== "undefined" && state && state.style && NODE_SHAPES.has(state.style.shape) ? state.style.shape : "round";
  return {
    type: chosen || fallback,
    cx: node ? node.x : 0,
    cy: node ? node.y : 0,
    w,
    h,
    radius: Math.min(NODE_OUTLINE_RADIUS, w / 2, h / 2),
  };
}

function shapeContains(shape, x, y) {
  if (!shape) return false;
  const hw = shape.w / 2;
  const hh = shape.h / 2;
  const dx = Math.abs(x - shape.cx);
  const dy = Math.abs(y - shape.cy);
  if (shape.type === "ellipse") {
    if (hw < 1e-6 || hh < 1e-6) return false;
    return (dx * dx) / (hw * hw) + (dy * dy) / (hh * hh) <= 1 + 1e-6;
  }
  if (shape.type === "diamond") {
    if (hw < 1e-6 || hh < 1e-6) return false;
    return dx / hw + dy / hh <= 1 + 1e-6;
  }
  const r = shape.type === "rect" ? 0 : shape.type === "pill" ? Math.min(hw, hh) : Math.min(shape.radius || 0, hw, hh);
  if (dx > hw + 1e-6 || dy > hh + 1e-6) return false;
  if (r <= 0 || dx <= hw - r + 1e-6 || dy <= hh - r + 1e-6) return true;
  const cornerX = hw - r;
  const cornerY = hh - r;
  return (dx - cornerX) ** 2 + (dy - cornerY) ** 2 <= r * r + 1e-6;
}

// Randpunkt auf der Strecke von einem inneren zu einem äußeren Punkt.
function meetOutline(shape, inside, outside) {
  let a = inside;
  let b = outside;
  for (let step = 0; step < 20; step += 1) {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (shapeContains(shape, mid.x, mid.y)) a = mid;
    else b = mid;
  }
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// tip liegt außen, away ist der Nachbar auf der Bahn (weg von der Form).
// Der Rand liegt in Richtung tip - away.
function approachOutline(shape, tip, away) {
  if (shapeContains(shape, tip.x, tip.y)) return { x: tip.x, y: tip.y };
  const dx = tip.x - away.x;
  const dy = tip.y - away.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  let inside = null;
  let dist = 0.5;
  for (let step = 0; step < 24; step += 1) {
    dist *= 1.6;
    const point = { x: tip.x + ux * dist, y: tip.y + uy * dist };
    if (shapeContains(shape, point.x, point.y)) {
      inside = point;
      break;
    }
  }
  if (!inside) {
    const center = { x: shape.cx, y: shape.cy };
    if (!shapeContains(shape, center.x, center.y)) return { x: tip.x, y: tip.y };
    return meetOutline(shape, center, tip);
  }
  return meetOutline(shape, inside, tip);
}

function trimLeaving(points, shape) {
  let index = 0;
  while (index < points.length && shapeContains(shape, points[index].x, points[index].y)) index += 1;
  if (index === 0 || index >= points.length) return null;
  const hit = meetOutline(shape, points[index - 1], points[index]);
  return [hit, ...points.slice(index)];
}

function trimEntering(points, shape) {
  let index = points.length - 1;
  while (index >= 0 && shapeContains(shape, points[index].x, points[index].y)) index -= 1;
  if (index < 0 || index === points.length - 1) return null;
  const hit = meetOutline(shape, points[index + 1], points[index]);
  return [...points.slice(0, index + 1), hit];
}

function sampleEdgePath(d) {
  const tokens = String(d || "").match(/[MLHVCSQTAZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  if (!tokens) return [];
  const points = [];
  const stepsFor = (distance) => Math.max(8, Math.ceil(distance / 1.5));
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

function edgePathFromPoints(points) {
  const fmt = (value) => String(Math.round(value * 100) / 100);
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${fmt(point.x)} ${fmt(point.y)}`).join(" ");
}

function dedupeEdgePoints(points) {
  const clean = [];
  for (const point of points) {
    const prev = clean[clean.length - 1];
    if (prev && Math.hypot(prev.x - point.x, prev.y - point.y) < 0.05) continue;
    clean.push(point);
  }
  return clean;
}

// Beschneidet die gezeichnete Bahn auf den Rand beider Formen.
// Start = Austritt aus der Elternform, Ende = Eintritt in die Kindform.
function clipEdgeToShapes(d, parentShape, childShape) {
  let points = sampleEdgePath(d);
  if (points.length < 2 || !parentShape || !childShape) return null;

  const leaving = trimLeaving(points, parentShape);
  if (leaving) points = leaving;
  else points[0] = approachOutline(parentShape, points[0], points[1]);

  const entering = trimEntering(points, childShape);
  if (entering) points = entering;
  else {
    const last = points.length - 1;
    points[last] = approachOutline(childShape, points[last], points[last - 1]);
  }

  points = dedupeEdgePoints(points);
  if (points.length < 2) return null;
  return { d: edgePathFromPoints(points), start: points[0], end: points[points.length - 1] };
}
