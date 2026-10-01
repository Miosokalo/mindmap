/**
 * Ultimativer Anti-Collider.
 *
 * Nach jedem automatischen Anordnen (relayoutNodes in layout.js) wird hiermit
 * sichergestellt, dass in der Mindmap nichts überkreuzt:
 *   1. keine zwei Knoten überlappen (inkl. Mindestabstand),
 *   2. keine Kante durch einen fremden Knoten läuft (Start-/Endknoten ausgenommen),
 *   3. keine zwei Kanten sich kreuzen (Kanten mit gemeinsamem Ursprung und
 *      aufeinanderfolgende Kanten ausgenommen — die berühren sich legitim).
 *
 * Verletzungen werden behoben, indem jeweils der „außenliegende“ Teilbaum
 * (nie die Wurzel) als Ganzes verschoben wird — Verbindungen bleiben intakt.
 * Das läuft iterativ, bis keine Verletzung mehr existiert.
 *
 * Die Kantengeometrie wird zur Laufzeit aus app.js geholt (computeEdgePath),
 * damit genau die tatsächlich gezeichneten Linien geprüft werden.
 * Läuft als klassisches Skript VOR app.js. Für Tests:
 * window.AntiCollider.report(nodes, lineKind) → Anzahl der Verletzungen.
 */
(() => {
  "use strict";

  const NODE_PAD = 5; // Mindestabstand zwischen Knoten (px)
  const EDGE_PAD = 3; // Mindestabstand Kante–Knoten (px)
  const MAX_PASSES = 80;

  // ---------- Pfad-Geometrie (reine Mathematik, kein DOM) ----------

  // "d"-String (M/L/H/V/C) → dichte Polylinie. Kubische Kurven werden
  // fein genug abgetastet (Schrittweite ≤ 6 px), alles andere ist exakt.
  function parsePathD(d) {
    const points = [];
    if (typeof d !== "string" || !d) return points;
    const re = /([A-Za-z])((?:[^A-Za-z])*)/g;
    let m;
    let cx = 0;
    let cy = 0;
    while ((m = re.exec(d))) {
      const cmd = m[1];
      const nums = (m[2].match(/-?\d*\.?\d+/g) || []).map(Number);
      if (cmd === "M" && nums.length >= 2) {
        cx = nums[0];
        cy = nums[1];
        points.push({ x: cx, y: cy });
      } else if (cmd === "L" && nums.length >= 2) {
        cx = nums[0];
        cy = nums[1];
        points.push({ x: cx, y: cy });
      } else if (cmd === "H") {
        for (const x of nums) {
          cx = x;
          points.push({ x: cx, y: cy });
        }
      } else if (cmd === "V") {
        for (const y of nums) {
          cy = y;
          points.push({ x: cx, y: cy });
        }
      } else if (cmd === "C" && nums.length >= 6) {
        const x1 = nums[0];
        const y1 = nums[1];
        const x2 = nums[2];
        const y2 = nums[3];
        const x = nums[4];
        const y = nums[5];
        const steps = Math.max(4, Math.ceil(Math.hypot(x - cx, y - cy) / 6));
        for (let i = 1; i <= steps; i += 1) {
          const t = i / steps;
          const u = 1 - t;
          points.push({
            x: u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
            y: u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
          });
        }
        cx = x;
        cy = y;
      }
    }
    return points;
  }

  // Schnitt zweier Strecken (p1→p2 × q1→q2). Liefert den Schnittpunkt oder null.
  function segmentCross(p1, p2, q1, q2) {
    const rx = p2.x - p1.x;
    const ry = p2.y - p1.y;
    const sx = q2.x - q1.x;
    const sy = q2.y - q1.y;
    const denom = rx * sy - ry * sx;
    if (Math.abs(denom) < 1e-9) return null; // parallel (oder fast parallel)
    const t = ((q1.x - p1.x) * sy - (q1.y - p1.y) * sx) / denom;
    const u = ((q1.x - p1.x) * ry - (q1.y - p1.y) * rx) / denom;
    if (t <= 0.001 || t >= 0.999 || u <= 0.001 || u >= 0.999) return null; // nur echte Innen-Schnitte
    return { x: p1.x + t * rx, y: p1.y + t * ry };
  }

  // ---------- Kontext (Eltern-Beziehungen ändern sich hier nie) ----------

  function buildContext(nodes) {
    const kids = new Map();
    const depth = new Map();
    const seen = new Set(["root"]);
    const all = Object.values(nodes).filter((n) => n && Number.isFinite(n.x) && Number.isFinite(n.y));

    const walk = (id, d) => {
      const list = all
        .filter((n) => n.parentId === id && n.id !== id)
        .sort((a, b) => (a.order || 0) - (b.order || 0));
      kids.set(id, list);
      for (const kid of list) {
        if (seen.has(kid.id)) continue; // defekte Zyklen defensiv ignorieren
        seen.add(kid.id);
        depth.set(kid.id, d + 1);
        walk(kid.id, d + 1);
      }
    };
    if (nodes.root) {
      depth.set("root", 0);
      walk("root", 0);
    }

    const ctx = {
      nodes,
      kids,
      depth,
      all,
      box(n, pad) {
        const w = (n.w || 48) / 2 + (pad || 0);
        const h = (n.h || 22) / 2 + (pad || 0);
        return { l: n.x - w, r: n.x + w, t: n.y - h, b: n.y + h };
      },
      shiftTree(id, dx, dy) {
        const n = nodes[id];
        if (!n) return;
        n.x += dx;
        n.y += dy;
        for (const kid of kids.get(id) || []) ctx.shiftTree(kid.id, dx, dy);
      },
      subtreeSize(id) {
        let sum = 1;
        for (const kid of kids.get(id) || []) sum += ctx.subtreeSize(kid.id);
        return sum;
      },
      isAncestor(ancId, id) {
        let n = nodes[id];
        let guard = 0;
        while (n && n.parentId && guard < 10000) {
          if (n.parentId === ancId) return true;
          n = nodes[n.parentId];
          guard += 1;
        }
        return false;
      },
      pickMover(a, b) {
        // Die Wurzel selbst wandert nie (sie trägt die ganze Karte).
        if (a.id === "root" || ctx.isAncestor(a.id, b.id)) return b;
        if (b.id === "root" || ctx.isAncestor(b.id, a.id)) return a;
        const da = depth.has(a.id) ? depth.get(a.id) : 99;
        const db = depth.has(b.id) ? depth.get(b.id) : 99;
        if (da !== db) return da > db ? a : b; // der tiefere wandert
        const root = nodes.root;
        return Math.hypot(a.x - root.x, a.y - root.y) >= Math.hypot(b.x - root.x, b.y - root.y) ? a : b;
      },
    };
    return ctx;
  }

  // ---------- Scan: alle Verletzungen finden ----------

  function scan(ctx, lineKind) {
    const { nodes, all, box } = ctx;
    const nodePairs = [];
    const edgeNode = [];
    const edgeEdge = [];

    // 1) Knoten–Knoten
    for (let i = 0; i < all.length; i += 1) {
      for (let j = i + 1; j < all.length; j += 1) {
        const a = all[i];
        const b = all[j];
        const A = box(a, NODE_PAD);
        const B = box(b, NODE_PAD);
        if (A.r > B.l && B.r > A.l && A.b > B.t && B.b > A.t) nodePairs.push({ a, b });
      }
    }

    // Kanten genau wie beim Zeichnen (computeEdgePath aus app.js)
    const edges = [];
    if (typeof computeEdgePath === "function") {
      for (const node of all) {
        if (!node.parentId) continue;
        const parent = nodes[node.parentId];
        if (!parent) continue;
        const d = computeEdgePath(nodes, node, parent, lineKind);
        const points = parsePathD(d);
        if (points.length < 2) continue;
        let l = Infinity;
        let r = -Infinity;
        let t = Infinity;
        let b = -Infinity;
        for (const p of points) {
          l = Math.min(l, p.x);
          r = Math.max(r, p.x);
          t = Math.min(t, p.y);
          b = Math.max(b, p.y);
        }
        edges.push({ parentId: parent.id, childId: node.id, points, l, r, t, b });
      }
    }

    // 2) Kante–Knoten
    for (const edge of edges) {
      const hitNodes = new Set();
      for (const p of edge.points) {
        for (const node of all) {
          if (node.id === edge.parentId || node.id === edge.childId || hitNodes.has(node.id)) continue;
          const bx = box(node, EDGE_PAD);
          if (p.x > bx.l && p.x < bx.r && p.y > bx.t && p.y < bx.b) hitNodes.add(node.id);
        }
      }
      for (const id of hitNodes) edgeNode.push({ node: nodes[id], edge });
    }

    // 3) Kante–Kante
    for (let i = 0; i < edges.length; i += 1) {
      for (let j = i + 1; j < edges.length; j += 1) {
        const e1 = edges[i];
        const e2 = edges[j];
        if (e1.parentId === e2.parentId) continue; // gemeinsamer Ursprung: berühren sich legitim
        if (e1.childId === e2.parentId || e2.childId === e1.parentId) continue; // aufeinanderfolgend
        if (e1.r < e2.l || e2.r < e1.l || e1.b < e2.t || e2.b < e1.t) continue; // Bounding-Box-Filter
        let found = null;
        for (let a = 0; !found && a < e1.points.length - 1; a += 1) {
          for (let b = 0; !found && b < e2.points.length - 1; b += 1) {
            const hit = segmentCross(e1.points[a], e1.points[a + 1], e2.points[b], e2.points[b + 1]);
            if (hit) {
              found = {
                e1,
                e2,
                x: hit.x,
                y: hit.y,
                tx1: e1.points[a + 1].x - e1.points[a].x,
                ty1: e1.points[a + 1].y - e1.points[a].y,
                tx2: e2.points[b + 1].x - e2.points[b].x,
                ty2: e2.points[b + 1].y - e2.points[b].y,
              };
            }
          }
        }
        if (found) edgeEdge.push(found);
      }
    }

    return { nodePairs, edgeNode, edgeEdge };
  }

  // ---------- Fixes: jeweils den außenliegenden Teilbaum verschieben ----------

  function fixNodePair(ctx, a, b) {
    const { nodes, box } = ctx;
    const A = box(a, 0);
    const B = box(b, 0);
    const ox = Math.min(A.r, B.r) - Math.max(A.l, B.l); // > 0: horizontal überlappt
    const oy = Math.min(A.b, B.b) - Math.max(A.t, B.t);
    const needX = ox > 0 ? ox + NODE_PAD : 0;
    const needY = oy > 0 ? oy + NODE_PAD : 0;
    if (!needX && !needY) return; // im selben Pass schon getrennt
    const p = ctx.pickMover(a, b);
    const q = p === a ? b : a;
    const root = nodes.root;
    if (needX && (!needY || needX <= needY)) {
      const sign = Math.sign(p.x - q.x) || Math.sign(p.x - root.x) || 1;
      ctx.shiftTree(p.id, sign * needX, 0);
    } else if (needY) {
      const sign = Math.sign(p.y - q.y) || Math.sign(p.y - root.y) || 1;
      ctx.shiftTree(p.id, 0, sign * needY);
    }
  }

  function fixEdgeNode(ctx, node, edge) {
    const { nodes, box } = ctx;
    const inside = (b, p) => p.x > b.l && p.x < b.r && p.y > b.t && p.y < b.b;
    const firstHit = () => {
      const b = box(node, EDGE_PAD);
      for (const p of edge.points) if (inside(b, p)) return p;
      return null;
    };
    const hit = firstHit();
    if (!hit) return; // im selben Pass schon frei

    // Wegrichtung: vom Trefferpunkt weg aus dem Knoten; liegt der Treffer
    // praktisch im Zentrum, senkrecht zur Kante (bevorzugt von der Wurzel weg).
    let dx = node.x - hit.x;
    let dy = node.y - hit.y;
    if (Math.hypot(dx, dy) < 0.5) {
      const idx = edge.points.indexOf(hit);
      const other = edge.points[Math.min(idx + 1, edge.points.length - 1)] || hit;
      const tx = other.x - hit.x;
      const ty = other.y - hit.y;
      const len = Math.hypot(tx, ty) || 1;
      dx = -ty / len;
      dy = tx / len;
      const root = nodes.root;
      if (Math.sign(dx) * Math.sign(node.x - root.x) + Math.sign(dy) * Math.sign(node.y - root.y) < 0) {
        dx = -dx;
        dy = -dy;
      }
    } else {
      const len = Math.hypot(dx, dy);
      dx /= len;
      dy /= len;
    }

    // Die Wurzel selbst wandert nie — stattdessen wandert das Kanten-Ende.
    const target = node.id === "root" ? nodes[edge.childId] : node;
    if (!target) return;
    for (let step = 0; step < 24; step += 1) {
      ctx.shiftTree(target.id, dx * 6, dy * 6);
      if (!firstHit()) break;
    }
  }

  function fixEdgeEdge(ctx, v) {
    const { nodes } = ctx;
    const b1 = nodes[v.e1.childId];
    const b2 = nodes[v.e2.childId];
    if (!b1 || !b2 || b1.id === "root" || b2.id === "root") return;
    // Der kleinere Teilbaum wandert (bei Gleichstand: der tiefere Knoten).
    const size1 = ctx.subtreeSize(b1.id);
    const size2 = ctx.subtreeSize(b2.id);
    let mover;
    let anchorId;
    let t;
    if (size1 !== size2) {
      mover = size1 < size2 ? b1 : b2;
    } else {
      const d1 = ctx.depth.has(b1.id) ? ctx.depth.get(b1.id) : 99;
      const d2 = ctx.depth.has(b2.id) ? ctx.depth.get(b2.id) : 99;
      mover = d1 >= d2 ? b1 : b2;
    }
    if (mover === b1) {
      anchorId = v.e1.parentId; // zum eigenen Ursprung über die Kreuzung hinweg
      t = { x: v.tx2, y: v.ty2 }; // Senkrechte zur anderen Kante
    } else {
      anchorId = v.e2.parentId;
      t = { x: v.tx1, y: v.ty1 };
    }
    const anchor = nodes[anchorId];
    if (!anchor) return;
    const tlen = Math.hypot(t.x, t.y) || 1;
    let nx = -t.y / tlen;
    let ny = t.x / tlen;
    if ((anchor.x - v.x) * nx + (anchor.y - v.y) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    // mover muss klar auf die anchor-Seite der anderen Kante.
    const s = (mover.x - v.x) * nx + (mover.y - v.y) * ny;
    const margin = 10 + Math.abs(nx) * ((mover.w || 48) / 2) + Math.abs(ny) * ((mover.h || 22) / 2);
    if (s < margin) ctx.shiftTree(mover.id, nx * (margin - s), ny * (margin - s));
  }

  // ---------- Öffentliche API ----------

  function collide(nodes, lineKind, apply) {
    if (!nodes || !nodes.root) return { nodePairs: [], edgeNode: [], edgeEdge: [] };
    const ctx = buildContext(nodes);
    const violations = scan(ctx, lineKind);
    if (apply) {
      for (const v of violations.nodePairs) fixNodePair(ctx, v.a, v.b);
      for (const v of violations.edgeNode) fixEdgeNode(ctx, v.node, v.edge);
      for (const v of violations.edgeEdge) fixEdgeEdge(ctx, v);
    }
    return violations;
  }

  function antiCollide(nodes, lineKind) {
    if (!nodes || !nodes.root) return true;
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const before = collide(nodes, lineKind, false);
      if (!before.nodePairs.length && !before.edgeNode.length && !before.edgeEdge.length) return true;
      collide(nodes, lineKind, true);
    }
    const after = collide(nodes, lineKind, false);
    return !after.nodePairs.length && !after.edgeNode.length && !after.edgeEdge.length;
  }

  function report(nodes, lineKind) {
    const v = collide(nodes, lineKind, false);
    return {
      nodeNode: v.nodePairs.length,
      edgeNode: v.edgeNode.length,
      edgeEdge: v.edgeEdge.length,
      clean: !v.nodePairs.length && !v.edgeNode.length && !v.edgeEdge.length,
    };
  }

  // Als globale Funktion bereitstellen (app.js ruft sie nach jedem
  // automatischen Anordnen auf); report für Tests/Diagnose.
  window.antiCollide = antiCollide;
  window.AntiCollider = { report };
})();
