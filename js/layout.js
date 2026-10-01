// Anordnung einer Mindmap.
// Richtungen: n oben, e rechts, s unten, w links.
// Unterpunkte wachsen in dieselbe Richtung weiter.
// Bei "around" liegen große Äste links/rechts, kleinere oben/unten.

const LAYOUT_GAP = 14;
const LAYOUT_PAD = 8;

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
  return {
    w: measureText(node.text, branch),
    h: branch ? 30 : 18,
  };
}

function layoutAcross(nodes, id, dir, measureText) {
  const node = nodes[id];
  const kids = layoutChildren(nodes, id);
  const size = layoutNodeSize(node, kids.length > 0 || node.id === "root", measureText);
  if (layoutHorizontal(dir)) {
    const own = size.h + 4;
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
    const along = Math.max(halfParent + halfChild + LAYOUT_GAP, clearance + halfChild + LAYOUT_GAP);
    child.x = parent.x + ux * along + qx * mid;
    child.y = parent.y + uy * along + qy * mid;
    child.ray = angle;
    child.angle = Math.atan2(-(child.y - parent.y), child.x - parent.x);
    child.dir = angleToDir(angle);
    child.gutter = false;
    cursor += spans[index];
  });
}

function placeFlatColumn(nodes, parent, angle, measureText) {
  const items = [];
  const walk = (id) => {
    for (const kid of layoutChildren(nodes, id)) {
      const grand = layoutChildren(nodes, kid.id);
      const size = layoutNodeSize(kid, grand.length > 0, measureText);
      kid.w = size.w;
      kid.h = size.h;
      items.push(kid);
      walk(kid.id);
    }
  };
  walk(parent.id);
  if (!items.length) return;
  const ux = Math.cos(angle);
  const uy = -Math.sin(angle);
  const vertical = Math.abs(uy) >= Math.abs(ux);
  const sign = vertical && uy < 0 ? -1 : 1;
  const total = items.reduce((sum, child) => sum + child.h + 4, 0);
  let y = vertical ? parent.y + sign * (parent.h / 2 + 8) : parent.y - total / 2;
  const toRight = ux >= 0;
  const xEdge = parent.x + (toRight ? parent.w / 2 + 10 : -(parent.w / 2 + 10));
  for (const child of items) {
    y += sign * (child.h / 2 + 2);
    child.x = toRight ? xEdge + child.w / 2 : xEdge - child.w / 2;
    child.y = y;
    child.ray = angle;
    child.dir = angleToDir(angle);
    child.gutter = true;
    child.spine = toRight ? "w" : "e";
    y += sign * (child.h / 2 + 2);
  }
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

function placeRadial(nodes, parent, style, measureText) {
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
  kids.forEach((child) => {
    const reach =
      extentAlong(parent.w || 48, parent.h || 22, Math.cos(child.angle), -Math.sin(child.angle)) +
      extentAlong(child.w, child.h, Math.cos(child.angle), -Math.sin(child.angle)) +
      LAYOUT_GAP;
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
    layoutSubtree(nodes, child, style, measureText);
  });
}

function layoutSubtree(nodes, anchor, style, measureText) {
  const kids = layoutChildren(nodes, anchor.id);
  const size = layoutNodeSize(anchor, kids.length > 0 || anchor.id === "root", measureText);
  anchor.w = size.w;
  anchor.h = size.h;
  if (!kids.length) return;
  const flow = flowFor(anchor, style);
  if (flow === "radial") {
    placeRadial(nodes, anchor, style, measureText);
    nudgeOutward(nodes, anchor);
    return;
  }
  if (flow === "continue") {
    const angle =
      typeof anchor.ray === "number" ? anchor.ray : typeof anchor.angle === "number" ? anchor.angle : DIR_ANGLE[anchor.dir || "e"];
    const cardinal = Object.entries(DIR_ANGLE).find(([, value]) => Math.abs(value - angle) < 0.001);
    const parent = anchor.parentId ? nodes[anchor.parentId] : null;
    const fromRadial = style.layout === "radial" || (parent && parent.flow === "radial");
    if (!fromRadial && cardinal && (cardinal[0] === "e" || cardinal[0] === "w")) {
      for (const kid of kids) {
        const grandchildren = layoutChildren(nodes, kid.id);
        const kidSize = layoutNodeSize(kid, grandchildren.length > 0, measureText);
        kid.w = kidSize.w;
        kid.h = kidSize.h;
      }
      placeAlongAngle(nodes, anchor, kids, angle, measureText, 0);
      for (const kid of kids) layoutSubtree(nodes, kid, style, measureText);
      return;
    }
    placeFlatColumn(nodes, anchor, angle, measureText);
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
    for (const kid of list) layoutSubtree(nodes, kid, style, measureText);
  }
  nudgeOutward(nodes, anchor);
}

function relayoutNodes(nodes, style, anchorId, measureText) {
  const anchor = nodes[anchorId] || nodes.root;
  if (!anchor) return nodes;
  layoutSubtree(nodes, anchor, style, measureText);
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
