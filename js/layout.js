// Anordnung einer Mindmap.
// Richtungen: n oben, e rechts, s unten, w links.
// Unterpunkte wachsen in dieselbe Richtung weiter.
// "around" fächert in der Fließrichtung auf: zwei Kinder gabeln sich,
// mehr Kinder nutzen den freien Bogen davor, mit Abstand zum Elternknoten.
// Die Linien starten gleichmäßig auf den dabei getroffenen Kanten.

const LAYOUT_GAP = 14;
const LAYOUT_PAD = 8;

function layoutReach(node) {
  const value = Number(node && node.reach);
  if (!Number.isFinite(value)) return LAYOUT_GAP;
  return Math.min(240, Math.max(0, value));
}

function layoutChildren(nodes, id) {
  return Object.values(nodes)
    .filter((node) => node.parentId === id)
    .sort((a, b) => a.order - b.order);
}

function layoutLeafCount(nodes, id) {
  const kids = layoutChildren(nodes, id);
  if (!kids.length) return 1;
  return kids.reduce((sum, kid) => sum + layoutLeafCount(nodes, kid.id), 0);
}

function layoutHorizontal(dir) {
  return dir === "e" || dir === "w";
}

function layoutSign(dir) {
  return dir === "e" || dir === "s" ? 1 : -1;
}

function layoutNodeSize(node, branch, measureText) {
  const pad = typeof shapePad === "function" ? shapePad(node, branch) : { x: branch ? 10 : 2, y: branch ? 5 : 1 };
  return {
    w: measureText(node.text, branch, node),
    h: Math.ceil(16.25 + pad.y * 2 + 2),
  };
}

function layoutAcross(nodes, id, dir, measureText) {
  const node = nodes[id];
  const kids = layoutChildren(nodes, id);
  const size = layoutNodeSize(node, kids.length > 0 || node.id === "root", measureText);
  if (node.flow === "around" && kids.length && layoutHorizontal(dir)) {
    const gap = 16;
    let stack = 0;
    for (const kid of kids) {
      const nested = layoutChildren(nodes, kid.id);
      const kidSize = layoutNodeSize(kid, nested.length > 0, measureText);
      stack += nested.length ? Math.max(kidSize.h + gap, layoutAcross(nodes, kid.id, dir, measureText)) : kidSize.h + gap;
    }
    return Math.max(size.h + 8, stack);
  }
  if (layoutHorizontal(dir)) {
    const own = size.h + 8;
    if (!kids.length) return own;
    const sum = kids.reduce((total, kid) => total + layoutAcross(nodes, kid.id, dir, measureText), 0);
    return Math.max(own, sum);
  }
  const own = size.w + LAYOUT_PAD;
  if (!kids.length) return own;
  let widest = own;
  for (const kid of kids) widest = Math.max(widest, layoutAcross(nodes, kid.id, dir, measureText));
  return widest + LAYOUT_GAP;
}

function layoutPrefer(node, index) {
  if (node.prefer === "n" || node.prefer === "e" || node.prefer === "s" || node.prefer === "w") {
    return node.prefer;
  }
  if (node.side === "left" || node.side < 0) return "w";
  if (node.side === "right" || node.side > 0) return "e";
  if (node.side === "up") return "n";
  if (node.side === "down") return "s";
  return index % 2 === 0 ? "e" : "w";
}

function layoutBalance(nodes, kids, dirs) {
  const groups = Object.fromEntries(dirs.map((dir) => [dir, []]));
  const load = Object.fromEntries(dirs.map((dir) => [dir, 0]));
  const ranked = [...kids].sort((a, b) => layoutLeafCount(nodes, b.id) - layoutLeafCount(nodes, a.id));
  for (const kid of ranked) {
    const dir = dirs.reduce((best, candidate) => (load[candidate] < load[best] ? candidate : best));
    groups[dir].push(kid);
    load[dir] += layoutLeafCount(nodes, kid.id);
  }
  for (const dir of dirs) groups[dir].sort((a, b) => a.order - b.order);
  return dirs.map((dir) => [dir, groups[dir]]);
}

const DIR_ANGLE = { e: 0, n: Math.PI / 2, w: Math.PI, s: -Math.PI / 2 };

function flowFor(node, style) {
  if (node.flow === "horizontal" || node.flow === "vertical" || node.flow === "around" || node.flow === "radial") {
    return node.flow;
  }
  if (!node.parentId) {
    const layout = style && style.layout;
    if (layout === "horizontal" || layout === "vertical" || layout === "around" || layout === "radial") return layout;
    return "around";
  }
  return "continue";
}

function layoutGroups(nodes, anchor, flow) {
  const kids = layoutChildren(nodes, anchor.id);
  if (flow === "continue") return [[anchor.dir || "e", kids]];
  if (flow === "horizontal") {
    const groups = { e: [], w: [] };
    kids.forEach((kid, index) => {
      const dir = layoutPrefer(kid, index);
      groups[dir === "w" ? "w" : "e"].push(kid);
    });
    return [
      ["e", groups.e],
      ["w", groups.w],
    ];
  }
  if (flow === "vertical") return layoutBalance(nodes, kids, ["n", "s"]);
  const ranked = [...kids].sort((a, b) => layoutLeafCount(nodes, b.id) - layoutLeafCount(nodes, a.id));
  const groups = { e: [], w: [], n: [], s: [] };
  if (ranked[0]) groups.e.push(ranked[0]);
  if (ranked[1]) groups.w.push(ranked[1]);
  const rest = layoutBalance(nodes, ranked.slice(2), ["n", "s"]);
  for (const [dir, list] of rest) groups[dir] = list;
  for (const dir of ["e", "w", "n", "s"]) groups[dir].sort((a, b) => a.order - b.order);
  return ["e", "w", "n", "s"].map((dir) => [dir, groups[dir]]);
}

function extentAlong(w, h, x, y) {
  return (Math.abs(x) * w) / 2 + (Math.abs(y) * h) / 2;
}

function placeAlongAngle(nodes, parent, kids, angle, measureText, clearance) {
  if (!kids.length) return;
  const ux = Math.cos(angle);
  const uy = -Math.sin(angle);
  const qx = -Math.sin(angle);
  const qy = -Math.cos(angle);
  const cardinal = Object.entries(DIR_ANGLE).find(([, value]) => Math.abs(value - angle) < 0.001);
  const spans = kids.map((kid) =>
    cardinal
      ? layoutAcross(nodes, kid.id, cardinal[0], measureText)
      : extentAlong(kid.w || 48, kid.h || 22, qx, qy) * 2 + 12,
  );
  const total = spans.reduce((sum, span) => sum + span, 0);
  let cursor = -total / 2;
  kids.forEach((child, index) => {
    const mid = cursor + spans[index] / 2;
    const halfParent = extentAlong(parent.w || 48, parent.h || 22, ux, uy);
    const halfChild = extentAlong(child.w || 48, child.h || 22, ux, uy);
    const gap = layoutReach(parent);
    const along = Math.max(halfParent + halfChild + gap, clearance + halfChild + gap);
    child.x = parent.x + ux * along + qx * mid;
    child.y = parent.y + uy * along + qy * mid;
    child.ray = angle;
    child.angle = Math.atan2(-(child.y - parent.y), child.x - parent.x);
    child.dir = angleToDir(angle);
    child.gutter = false;
    cursor += spans[index];
  });
}

function columnSpan(nodes, id, measureText) {
  const node = nodes[id];
  const kids = layoutChildren(nodes, id);
  const size = layoutNodeSize(node, kids.length > 0 || node.id === "root", measureText);
  if (!kids.length) return size.h + 8;
  let stack = 0;
  for (const kid of kids) stack += columnSpan(nodes, kid.id, measureText);
  return Math.max(size.h + 8, stack);
}

function placeFlatColumn(nodes, parent, angle, measureText) {
  const items = layoutChildren(nodes, parent.id);
  if (!items.length) return;
  for (const kid of items) {
    const grand = layoutChildren(nodes, kid.id);
    const size = layoutNodeSize(kid, grand.length > 0, measureText);
    kid.w = size.w;
    kid.h = size.h;
  }
  const ux = Math.cos(angle);
  const uy = -Math.sin(angle);
  const vertical = Math.abs(uy) >= Math.abs(ux);
  const sign = vertical && uy < 0 ? -1 : 1;
  const gap = layoutReach(parent);
  const spans = items.map((child) => columnSpan(nodes, child.id, measureText));
  const total = spans.reduce((sum, span) => sum + span, 0);
  let cursor = vertical ? parent.y + sign * (parent.h / 2 + gap) : parent.y - total / 2;
  const toRight = ux >= 0;
  const xEdge = parent.x + (toRight ? parent.w / 2 + gap : -(parent.w / 2 + gap));
  items.forEach((child, index) => {
    if (vertical) {
      child.y = cursor + sign * (child.h / 2);
      cursor += sign * spans[index];
    } else {
      child.y = cursor + spans[index] / 2;
      cursor += spans[index];
    }
    child.x = toRight ? xEdge + child.w / 2 : xEdge - child.w / 2;
    child.ray = angle;
    child.dir = angleToDir(angle);
    child.gutter = true;
    child.spine = toRight ? "w" : "e";
  });
}

function subtreeBounds(nodes, id) {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  const walk = (nodeId) => {
    const node = nodes[nodeId];
    const width = node.w || 40;
    const height = node.h || 18;
    left = Math.min(left, node.x - width / 2);
    right = Math.max(right, node.x + width / 2);
    top = Math.min(top, node.y - height / 2);
    bottom = Math.max(bottom, node.y + height / 2);
    for (const kid of layoutChildren(nodes, nodeId)) walk(kid.id);
  };
  walk(id);
  return { left, right, top, bottom };
}

function shiftSubtree(nodes, id, dx, dy) {
  nodes[id].x += dx;
  nodes[id].y += dy;
  for (const kid of layoutChildren(nodes, id)) shiftSubtree(nodes, kid.id, dx, dy);
}

function nudgeOutward(nodes, parent) {
  const kids = layoutChildren(nodes, parent.id);
  if (kids.length < 2) return;
  const pad = 8;
  for (let pass = 0; pass < 6; pass += 1) {
    let moved = false;
    for (let i = 0; i < kids.length; i += 1) {
      for (let j = i + 1; j < kids.length; j += 1) {
        const a = subtreeBounds(nodes, kids[i].id);
        const b = subtreeBounds(nodes, kids[j].id);
        const gapX = Math.max(a.left, b.left) - Math.min(a.right, b.right);
        const gapY = Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom);
        if (gapX >= pad || gapY >= pad) continue;
        const needX = pad - gapX;
        const needY = pad - gapY;
        if (needX <= needY) {
          const target = Math.abs(kids[i].x - parent.x) >= Math.abs(kids[j].x - parent.x) ? kids[i] : kids[j];
          shiftSubtree(nodes, target.id, (target.x >= parent.x ? 1 : -1) * needX, 0);
        } else {
          const target = Math.abs(kids[i].y - parent.y) >= Math.abs(kids[j].y - parent.y) ? kids[i] : kids[j];
          shiftSubtree(nodes, target.id, 0, (target.y >= parent.y ? 1 : -1) * needY);
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
}

function angleToDir(angle) {
  const turn = Math.PI * 2;
  let value = angle % turn;
  if (value <= -Math.PI) value += turn;
  if (value > Math.PI) value -= turn;
  if (value >= -Math.PI / 4 && value < Math.PI / 4) return "e";
  if (value >= Math.PI / 4 && value < (3 * Math.PI) / 4) return "n";
  if (value >= (-3 * Math.PI) / 4 && value < -Math.PI / 4) return "s";
  return "w";
}

function placeRadial(nodes, parent, style, measureText, shallow) {
  const kids = layoutChildren(nodes, parent.id);
  if (!kids.length) return;
  const origin = parent.parentId ? nodes[parent.parentId] : null;
  const full = !origin;
  const center = full
    ? 0
    : typeof parent.ray === "number"
      ? parent.ray
      : typeof parent.angle === "number"
        ? parent.angle
        : Math.atan2(-(parent.y - origin.y), parent.x - origin.x);
  const span = full ? Math.PI * 2 : Math.PI * 1.15;
  const step = span / kids.length;
  kids.forEach((child, index) => {
    const grandchildren = layoutChildren(nodes, child.id);
    const size = layoutNodeSize(child, grandchildren.length > 0, measureText);
    child.w = size.w;
    child.h = size.h;
    child.angle = full ? index * step : center - span / 2 + (index + 0.5) * step;
    child.wedge = step;
    child.gutter = false;
  });

  let radius = 0;
  const gap = layoutReach(parent);
  kids.forEach((child) => {
    const reach =
      extentAlong(parent.w || 48, parent.h || 22, Math.cos(child.angle), -Math.sin(child.angle)) +
      extentAlong(child.w, child.h, Math.cos(child.angle), -Math.sin(child.angle)) +
      gap;
    radius = Math.max(radius, reach);
  });
  for (let index = 0; index < kids.length; index += 1) {
    const next = kids[(index + 1) % kids.length];
    if (!full && index === kids.length - 1) continue;
    let delta = Math.abs(next.angle - kids[index].angle);
    if (delta > Math.PI) delta = Math.PI * 2 - delta;
    const sine = Math.sin(delta / 2);
    if (sine <= 0.04) continue;
    const half = (child) => extentAlong(child.w, child.h, -Math.sin(child.angle), -Math.cos(child.angle));
    radius = Math.max(radius, (half(kids[index]) + half(next) + 8) / (2 * sine));
  }

  kids.forEach((child) => {
    child.x = parent.x + Math.cos(child.angle) * radius;
    child.y = parent.y - Math.sin(child.angle) * radius;
    child.ray = child.angle;
    child.dir = angleToDir(child.angle);
    if (!shallow) layoutSubtree(nodes, child, style, measureText);
  });
}

function flowAngle(node, nodes) {
  if (!node.parentId) return null;
  if (typeof node.ray === "number") return node.ray;
  const origin = nodes[node.parentId];
  if (!origin) return 0;
  return Math.atan2(-(node.y - origin.y), node.x - origin.x);
}

function rayBox(width, height, ux, uy) {
  const ax = Math.abs(ux);
  const ay = Math.abs(uy);
  const tx = ax < 1e-6 ? Infinity : width / 2 / ax;
  const ty = ay < 1e-6 ? Infinity : height / 2 / ay;
  const hit = Math.min(tx, ty);
  return Number.isFinite(hit) ? hit : 0;
}

function flowBasis(center) {
  const fx = Math.cos(center);
  const fy = -Math.sin(center);
  let ux = fy;
  let uy = -fx;
  if (uy > 0 || (uy === 0 && ux < 0)) {
    ux = -ux;
    uy = -uy;
  }
  return { fx, fy, ux, uy };
}

function placeBouquet(nodes, anchor, parent, kids, center, measureText) {
  if (!kids.length) return;
  const { fx, fy, ux, uy } = flowBasis(center);
  const gap = 16;
  const count = kids.length;
  const outward = Math.abs(fx) >= Math.abs(fy) ? (fx >= 0 ? "e" : "w") : fy >= 0 ? "s" : "n";
  const spans = kids.map((kid) => {
    const nested = layoutChildren(nodes, kid.id);
    const horizontal = outward === "e" || outward === "w";
    if (!nested.length || !measureText || !horizontal) return kid.h + gap;
    return Math.max(kid.h + gap, layoutAcross(nodes, kid.id, outward, measureText));
  });
  const total = spans.reduce((sum, span) => sum + span, 0);
  let cursor = -total / 2;
  const rows = kids.map((child, index) => {
    const mid = -(cursor + spans[index] / 2);
    cursor += spans[index];
    const along =
      rayBox(parent.w || 48, parent.h || 22, fx, fy) + rayBox(child.w || 48, child.h || 22, fx, fy) + layoutReach(parent);
    return { child, mid, along };
  });

  const front = rows.reduce((max, row) => Math.max(max, row.along), 0);
  for (const row of rows) row.along = front;

  const blocked = new Set();
  const mark = (id) => {
    blocked.add(id);
    for (const kid of layoutChildren(nodes, id)) mark(kid.id);
  };
  mark(anchor.id);

  const place = () => {
    for (const row of rows) {
      row.child.x = parent.x + fx * row.along + ux * row.mid;
      row.child.y = parent.y + fy * row.along + uy * row.mid;
      row.child.gutter = false;
    }
  };

  const hitsOthers = () => {
    for (const row of rows) {
      const child = row.child;
      for (const other of Object.values(nodes)) {
        if (blocked.has(other.id) || !other.w) continue;
        const gapX =
          Math.max(child.x - child.w / 2, other.x - other.w / 2) - Math.min(child.x + child.w / 2, other.x + other.w / 2);
        const gapY =
          Math.max(child.y - child.h / 2, other.y - other.h / 2) - Math.min(child.y + child.h / 2, other.y + other.h / 2);
        if (gapX < 8 && gapY < 8) return true;
      }
    }
    return false;
  };

  place();
  for (let pass = 0; pass < 8 && hitsOthers(); pass += 1) {
    for (const row of rows) row.along += 16;
    place();
  }

  for (const row of rows) {
    const child = row.child;
    child.angle = Math.atan2(-(child.y - parent.y), child.x - parent.x);
    child.ray = center;
    child.dir = angleToDir(center);
  }
}

function placeAround(nodes, anchor, style, measureText, shallow) {
  const kids = layoutChildren(nodes, anchor.id);
  for (const kid of kids) {
    const grandchildren = layoutChildren(nodes, kid.id);
    const kidSize = layoutNodeSize(kid, grandchildren.length > 0, measureText);
    kid.w = kidSize.w;
    kid.h = kidSize.h;
  }
  const forward = flowAngle(anchor, nodes);
  if (forward == null) {
    const right = [];
    const left = [];
    kids.forEach((kid, index) => {
      (layoutPrefer(kid, index) === "w" ? left : right).push(kid);
    });
    if (right.length) placeBouquet(nodes, anchor, anchor, right, 0, measureText);
    if (left.length) placeBouquet(nodes, anchor, anchor, left, Math.PI, measureText);
  } else {
    placeBouquet(nodes, anchor, anchor, kids, forward, measureText);
  }
  if (!shallow) {
    for (const kid of kids) layoutSubtree(nodes, kid, style, measureText);
    nudgeOutward(nodes, anchor);
  }
}

function layoutSubtree(nodes, anchor, style, measureText, shallow) {
  const kids = layoutChildren(nodes, anchor.id);
  const size = layoutNodeSize(anchor, kids.length > 0 || anchor.id === "root", measureText);
  anchor.w = size.w;
  anchor.h = size.h;
  if (!kids.length) return;
  const flow = flowFor(anchor, style);
  if (flow === "radial") {
    placeRadial(nodes, anchor, style, measureText, shallow);
    if (!shallow) nudgeOutward(nodes, anchor);
    return;
  }
  if (flow === "around") {
    placeAround(nodes, anchor, style, measureText, shallow);
    return;
  }
  if (flow === "continue") {
    const angle =
      typeof anchor.ray === "number" ? anchor.ray : typeof anchor.angle === "number" ? anchor.angle : DIR_ANGLE[anchor.dir || "e"];
    const cardinal = Object.entries(DIR_ANGLE).find(([, value]) => Math.abs(value - angle) < 0.001);
    const parent = anchor.parentId ? nodes[anchor.parentId] : null;
    const fromRadial = style.layout === "radial" || (parent && parent.flow === "radial");
    const fromAround = parent && parent.flow === "around";
    if (fromAround || (!fromRadial && cardinal && (cardinal[0] === "e" || cardinal[0] === "w"))) {
      for (const kid of kids) {
        const grandchildren = layoutChildren(nodes, kid.id);
        const kidSize = layoutNodeSize(kid, grandchildren.length > 0, measureText);
        kid.w = kidSize.w;
        kid.h = kidSize.h;
      }
      placeAlongAngle(nodes, anchor, kids, angle, measureText, 0);
      if (!shallow) for (const kid of kids) layoutSubtree(nodes, kid, style, measureText);
      return;
    }
    placeFlatColumn(nodes, anchor, angle, measureText);
    if (!shallow) for (const kid of kids) layoutSubtree(nodes, kid, style, measureText);
    return;
  }
  const groups = layoutGroups(nodes, anchor, flow);
  for (const [, list] of groups) {
    for (const kid of list) {
      const grandchildren = layoutChildren(nodes, kid.id);
      const kidSize = layoutNodeSize(kid, grandchildren.length > 0, measureText);
      kid.w = kidSize.w;
      kid.h = kidSize.h;
    }
  }
  for (const [dir, list] of groups) {
    placeAlongAngle(nodes, anchor, list, DIR_ANGLE[dir], measureText, 0);
    if (!shallow) for (const kid of list) layoutSubtree(nodes, kid, style, measureText);
  }
  if (!shallow) nudgeOutward(nodes, anchor);
}

function borderSide(width, height, angle) {
  const dx = Math.cos(angle);
  const dy = -Math.sin(angle);
  const tx = Math.abs(dx) < 1e-6 ? Infinity : width / 2 / Math.abs(dx);
  const ty = Math.abs(dy) < 1e-6 ? Infinity : height / 2 / Math.abs(dy);
  if (tx <= ty) return dx >= 0 ? "e" : "w";
  return dy >= 0 ? "s" : "n";
}

function borderSideT(width, height, angle, side) {
  const dx = Math.cos(angle);
  const dy = -Math.sin(angle);
  const horizontal = side === "e" || side === "w";
  const dist = horizontal ? width / 2 / Math.max(Math.abs(dx), 1e-6) : height / 2 / Math.max(Math.abs(dy), 1e-6);
  const x = dx * dist;
  const y = dy * dist;
  if (horizontal) return (y + height / 2) / Math.max(height, 1);
  return (x + width / 2) / Math.max(width, 1);
}

// Gleichmäßige Startpunkte der ausgehenden Linien, gruppiert nach der getroffenen Kante.
function evenBorderPorts(parent, kids) {
  const width = Math.max(parent.w || 0, 1);
  const height = Math.max(parent.h || 0, 1);
  const groups = { n: [], e: [], s: [], w: [] };
  for (const kid of kids) {
    if (!Number.isFinite(kid.x) || !Number.isFinite(kid.y) || !Number.isFinite(parent.x) || !Number.isFinite(parent.y)) continue;
    const angle = Math.atan2(-(kid.y - parent.y), kid.x - parent.x);
    const side = borderSide(width, height, angle);
    groups[side].push({ kid, sort: borderSideT(width, height, angle, side) });
  }
  const ports = {};
  for (const side of ["n", "e", "s", "w"]) {
    const list = groups[side].sort((a, b) => a.sort - b.sort || (a.kid.order || 0) - (b.kid.order || 0));
    list.forEach((item, index) => {
      ports[item.kid.id] = { side, t: (index + 1) / (list.length + 1) };
    });
  }
  return ports;
}

function clearOutgoingPorts(nodes, id, deep) {
  for (const kid of layoutChildren(nodes, id)) {
    delete kid.port;
    if (deep) clearOutgoingPorts(nodes, kid.id, true);
  }
}

function subtreeRelative(nodes, id) {
  const origin = nodes[id];
  const list = [];
  const walk = (nodeId) => {
    for (const kid of layoutChildren(nodes, nodeId)) {
      list.push({ id: kid.id, dx: kid.x - origin.x, dy: kid.y - origin.y });
      walk(kid.id);
    }
  };
  walk(id);
  return list;
}

function segmentHitsRect(x1, y1, x2, y2, rect) {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const sides = [
    [-dx, x1 - rect.left],
    [dx, rect.right - x1],
    [-dy, y1 - rect.top],
    [dy, rect.bottom - y1],
  ];
  for (const [p, q] of sides) {
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return t1 - t0 > 1e-3;
}

function nodeRect(node, pad) {
  const width = node.w || 48;
  const height = node.h || 22;
  return {
    left: node.x - width / 2 - pad,
    right: node.x + width / 2 + pad,
    top: node.y - height / 2 - pad,
    bottom: node.y + height / 2 + pad,
  };
}

function ancestorOf(nodes, ancestorId, id) {
  let current = nodes[id];
  while (current && current.parentId) {
    if (current.parentId === ancestorId) return true;
    current = nodes[current.parentId];
  }
  return false;
}

// Schiebt überlappende Knoten auseinander, damit eine Linie am Rand ansetzen kann.
function clearCrossings(nodes) {
  const list = Object.values(nodes);
  const pad = 8;
  for (let pass = 0; pass < 8; pass += 1) {
    let moved = false;
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        const ra = nodeRect(a, 0);
        const rb = nodeRect(b, 0);
        const overlapX = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const overlapY = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (overlapX <= 0.5 || overlapY <= 0.5) continue;
        let target = ancestorOf(nodes, a.id, b.id) ? b.id : a.id;
        if (target === "root") target = b.id;
        const other = target === a.id ? b : a;
        const moving = nodes[target];
        const dx = overlapX < overlapY ? (moving.x >= other.x ? 1 : -1) * (overlapX + pad) : 0;
        const dy = overlapX < overlapY ? 0 : (moving.y >= other.y ? 1 : -1) * (overlapY + pad);
        shiftSubtree(nodes, target, dx, dy);
        moved = true;
      }
    }
    if (!moved) return;
  }
}

function relayoutOutgoing(nodes, anchorId, style, measureText) {
  const anchor = nodes[anchorId] || nodes.root;
  if (!anchor) return nodes;
  clearOutgoingPorts(nodes, anchor.id, false);
  const frozen = layoutChildren(nodes, anchor.id).map((kid) => ({
    id: kid.id,
    rel: subtreeRelative(nodes, kid.id),
  }));
  layoutSubtree(nodes, anchor, style, measureText, true);
  for (const item of frozen) {
    const kid = nodes[item.id];
    if (!kid) continue;
    for (const point of item.rel) {
      if (!nodes[point.id]) continue;
      nodes[point.id].x = kid.x + point.dx;
      nodes[point.id].y = kid.y + point.dy;
    }
  }
  nudgeOutward(nodes, anchor);
  clearCrossings(nodes);
  return nodes;
}

function relayoutNodes(nodes, style, anchorId, measureText) {
  const anchor = nodes[anchorId] || nodes.root;
  if (!anchor) return nodes;
  clearOutgoingPorts(nodes, anchor.id, true);
  layoutSubtree(nodes, anchor, style, measureText);
  clearCrossings(nodes);
  return nodes;
}

function buildTreeNodes(tree) {
  const nodes = {};
  let seq = 0;
  nodes.root = {
    id: "root",
    parentId: null,
    text: tree.text,
    x: 0,
    y: 0,
    order: 0,
    dir: null,
    color: "root",
    prefer: null,
  };

  const walk = (list, parentId, color) => {
    list.forEach((item, index) => {
      const id = `n${++seq}`;
      const prefer =
        item.side === "left" ? "w" : item.side === "right" ? "e" : item.side === "up" ? "n" : item.side === "down" ? "s" : null;
      nodes[id] = {
        id,
        parentId,
        text: item.text,
        x: 0,
        y: 0,
        order: index,
        dir: null,
        color: item.color || color,
        prefer,
      };
      if (item.children) walk(item.children, id, item.color || color);
    });
  };

  walk(tree.children || [], "root", "root");
  return nodes;
}
