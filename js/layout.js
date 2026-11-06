// Where everything goes on the diagram. Pure geometry: a project goes in, positions
// and wire routes come out. Nothing here touches the page, so it can be tested directly.
window.CS = window.CS || {};

(function (CS) {
  'use strict';

  const BLOCK_W = 236;
  const BUS_W = 130;
  const HEAD = 42; // Height of a block's title area.
  const ROW = 22; // Height of one port row.
  const FOOT = 10;
  const BUS_MIN_H = 120;
  const STUB = 16; // Straight wire leaving a port before it may turn.
  const CLEARANCE = 8; // Space wires keep from blocks they do not connect to.
  const LANE = 10; // Spacing between parallel wires.
  const DIE_X = 110; // Room inside the chip outline for wires going to pads.
  const DIE_TOP = 56;
  const DIE_BOTTOM = 40;
  const PIN_LABEL_GAP = 28; // Space between the chip outline and the end of a pin name.
  const GRID = 20;
  const CHAR_W = 6.8;
  const LABEL_H = 14;
  const LABEL_GAP = 4; // Space between a net name and the nearest wire.

  const blockWidth = (b) => (CS.roleOf(b) === 'bus' ? BUS_W : BLOCK_W);

  // A connected port faces the block it connects to, which keeps wires short.
  // Blocks stacked in one column both use their left side, so the wire stays clear.
  function portSide(p, block, port, centre) {
    if (port.side) return port.side; // The user placed this port by hand.
    const width = blockWidth(block);
    const link = p.links.find((l) => l.fromPort === port.id || l.toPort === port.id);
    if (link) {
      const peer = p.blocks.find((b) => b.id === (link.from === block.id ? link.to : link.from));
      if (peer) {
        const dx = (peer.x + blockWidth(peer) / 2) - (block.x + width / 2);
        if (Math.abs(dx) < width / 2) return 'left';
        return dx > 0 ? 'right' : 'left';
      }
    }
    if (port.external) return block.x + width / 2 < centre ? 'left' : 'right';
    if (port.dir === 'in') return 'left';
    if (port.dir === 'bus') return CS.roleOf(block) === 'subordinate' ? 'left' : 'right';
    return 'right';
  }

  function peerY(p, block, port) {
    const link = p.links.find((l) => l.fromPort === port.id || l.toPort === port.id);
    const peer = link && p.blocks.find((b) => b.id === (link.from === block.id ? link.to : link.from));
    return peer ? peer.y : Infinity;
  }

  // frozen holds each port's side and row, so that nothing jumps during a drag.
  function placeBlocks(p, frozen) {
    const xs = p.blocks.flatMap((b) => [b.x, b.x + blockWidth(b)]);
    const centre = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
    const blocks = new Map();
    const points = new Map();
    p.blocks.forEach((block) => {
      const left = [];
      const right = [];
      block.ports.forEach((port, index) => {
        const held = frozen && frozen.get(port.id);
        const rank = port.rank === undefined ? Infinity : port.rank;
        const entry = { port, index, y: peerY(p, block, port), rank: held ? held.row : rank };
        const side = held ? held.side : portSide(p, block, port, centre);
        (side === 'left' ? left : right).push(entry);
      });
      // Ordering each side by where its wire is heading removes most crossings.
      // A hand-placed row comes first; subtracting two Infinities gives NaN, which falls through.
      const order = (x, y) => (x.rank - y.rank) || (x.y - y.y) || (x.index - y.index);
      left.sort(order);
      right.sort(order);
      const width = blockWidth(block);
      const rows = Math.max(left.length, right.length);
      let height = Math.max(HEAD + rows * ROW + FOOT, 56);
      if (CS.roleOf(block) === 'bus') height = Math.max(height, BUS_MIN_H);
      const rowsOf = (list, side) => list.map((entry, i) => {
        const offset = HEAD + ROW * i;
        const point = {
          x: side === 'left' ? block.x : block.x + width,
          y: block.y + offset + ROW / 2,
          side,
          blockId: block.id,
          port: entry.port,
        };
        points.set(entry.port.id, point);
        return { port: entry.port, side, offset };
      });
      blocks.set(block.id, {
        x: block.x, y: block.y, w: width, h: height,
        rows: rowsOf(left, 'left').concat(rowsOf(right, 'right')),
      });
    });
    return { blocks, points };
  }

  const crosses = (a, b, rect, pad) => (
    Math.max(a.x, b.x) > rect.x - pad && Math.min(a.x, b.x) < rect.x + rect.w + pad
    && Math.max(a.y, b.y) > rect.y - pad && Math.min(a.y, b.y) < rect.y + rect.h + pad
  );

  function pathIsClear(path, rects, ownIds) {
    for (let i = 0; i < path.length - 1; i += 1) {
      for (const [id, rect] of rects) {
        if (crosses(path[i], path[i + 1], rect, ownIds.includes(id) ? 0 : CLEARANCE)) return false;
      }
    }
    return true;
  }

  // Two parallel wires of different nets may not run on top of one another.
  function usesTakenLane(path, lanes, net) {
    for (let i = 0; i < path.length - 1; i += 1) {
      const a = path[i];
      const b = path[i + 1];
      const vertical = a.x === b.x;
      if (a.x === b.x && a.y === b.y) continue;
      for (const lane of lanes) {
        if (lane.net === net || lane.vertical !== vertical) continue;
        const near = Math.abs(vertical ? lane.x1 - a.x : lane.y1 - a.y) < LANE - 3;
        const overlap = vertical
          ? Math.max(a.y, b.y) > Math.min(lane.y1, lane.y2) && Math.min(a.y, b.y) < Math.max(lane.y1, lane.y2)
          : Math.max(a.x, b.x) > Math.min(lane.x1, lane.x2) && Math.min(a.x, b.x) < Math.max(lane.x1, lane.x2);
        if (near && overlap) return true;
      }
    }
    return false;
  }

  // How many wires of other nets this path would cross.
  function crossingCount(path, lanes, net) {
    let count = 0;
    for (let i = 0; i < path.length - 1; i += 1) {
      const a = path[i];
      const b = path[i + 1];
      const vertical = a.x === b.x;
      for (const lane of lanes) {
        if (lane.net !== net && lane.vertical !== vertical) {
          const x = vertical ? a.x : lane.x1;
          const y = vertical ? lane.y1 : a.y;
          const xs = vertical ? [lane.x1, lane.x2] : [a.x, b.x];
          const ys = vertical ? [a.y, b.y] : [lane.y1, lane.y2];
          if (x > Math.min(...xs) && x < Math.max(...xs) && y > Math.min(...ys) && y < Math.max(...ys)) count += 1;
        }
      }
    }
    return count;
  }

  function simplify(path) {
    const out = [];
    path.forEach((point) => {
      const last = out[out.length - 1];
      if (!last || last.x !== point.x || last.y !== point.y) out.push(point);
    });
    return out.filter((point, i) => {
      if (i === 0 || i === out.length - 1) return true;
      const a = out[i - 1];
      const b = out[i + 1];
      return !((a.x === point.x && b.x === point.x) || (a.y === point.y && b.y === point.y));
    });
  }

  // Finds a wire path of straight horizontal and vertical runs. It tries the simplest
  // shape first (out, across, in), then one that goes around blocks in the way.
  // preferred is an offset from the middle, set when the user drags this wire. The wire
  // then takes the free channel closest to where it was dropped.
  function route(start, startDir, end, endDir, rects, lanes, net, ownIds, preferred) {
    const sx = start.x + startDir * STUB;
    const ex = end.x + endDir * STUB;
    const mid = (sx + ex) / 2 + (preferred || 0);
    const offsets = [0, LANE, -LANE, 2 * LANE, -2 * LANE, 3 * LANE, -3 * LANE];
    const edges = [...rects.values()].flatMap((r) => [r.x - CLEARANCE - LANE, r.x + r.w + CLEARANCE + LANE]);
    const outward = (x) => startDir * (x - start.x) >= STUB && endDir * (x - end.x) >= STUB;

    const singles = [];
    [mid, sx, ex, ...edges].forEach((x) => offsets.forEach((o) => {
      if (outward(x + o)) singles.push(x + o);
    }));
    const singleCost = (x) => Math.abs(x - mid);
    singles.sort((a, b) => singleCost(a) - singleCost(b));
    const single = (x) => simplify([start, { x, y: start.y }, { x, y: end.y }, end]);

    const midY = (start.y + end.y) / 2;
    const ys = [midY];
    rects.forEach((r) => {
      ys.push(r.y - CLEARANCE - LANE, r.y - CLEARANCE - 2 * LANE, r.y + r.h + CLEARANCE + LANE, r.y + r.h + CLEARANCE + 2 * LANE);
    });
    ys.sort((a, b) => Math.abs(a - midY) - Math.abs(b - midY));
    const double = (y, k) => {
      const ax = sx + startDir * k * LANE;
      const bx = ex + endDir * k * LANE;
      return simplify([start, { x: ax, y: start.y }, { x: ax, y }, { x: bx, y }, { x: bx, y: end.y }, end]);
    };

    // Of the paths that fit, take the one that crosses the fewest other wires.
    let best = null;
    let bestScore = Infinity;
    for (const x of singles) {
      const path = single(x);
      if (pathIsClear(path, rects, ownIds) && !usesTakenLane(path, lanes, net)) {
        const crossPenalty = preferred === undefined ? crossingCount(path, lanes, net) * 400 : 0;
        const score = crossPenalty + singleCost(x);
        if (score < bestScore) {
          best = path;
          bestScore = score;
        }
      }
    }
    if (best) return best;
    for (const y of ys) {
      for (const k of [0, 1, 2, 3]) {
        const path = double(y, k);
        if (pathIsClear(path, rects, ownIds) && !usesTakenLane(path, lanes, net)) return path;
      }
    }
    // Crowded: allow wires to run alongside one another, but still avoid blocks.
    for (const x of singles) {
      const path = single(x);
      if (pathIsClear(path, rects, ownIds)) return path;
    }
    for (const y of ys) {
      const path = double(y, 0);
      if (pathIsClear(path, rects, ownIds)) return path;
    }
    return single(mid);
  }

  function recordLanes(path, lanes, net) {
    for (let i = 0; i < path.length - 1; i += 1) {
      const a = path[i];
      const b = path[i + 1];
      lanes.push({ net, vertical: a.x === b.x, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
  }

  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  // Finds a spot beside the wire for a net name, clear of every wire, block and other
  // name. If nowhere is clear, it returns null: the name is then seen in the panel and
  // on hover, which is better than printing it over the wiring.
  function placeLabel(text, path, taken, marks, rects, wires, die) {
    const width = text.length * CHAR_W + 6;
    const segments = [];
    for (let i = 0; i < path.length - 1; i += 1) {
      const a = path[i];
      const b = path[i + 1];
      const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      segments.push({ a, b, length, horizontal: a.y === b.y, weight: a.y === b.y ? length : length * 0.5 });
    }
    segments.sort((x, y) => y.weight - x.weight);
    const isClear = (box) => (
      box.x >= die.x + 2 && box.y >= die.y + 2
      && box.x + box.w <= die.x + die.w - 2 && box.y + box.h <= die.y + die.h - 2
      && !taken.some((t) => overlaps(t, box))
      && !marks.some((t) => overlaps(t, box))
      && ![...rects.values()].some((r) => overlaps(r, box))
      && !wires.some((wire) => wire.some((point, i) => i < wire.length - 1 && crosses(point, wire[i + 1], box, 1)))
    );
    for (const { a, b, horizontal } of segments) {
      for (const share of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        const x = a.x + (b.x - a.x) * share;
        const y = a.y + (b.y - a.y) * share;
        const spots = horizontal
          ? [[x, y - LABEL_H / 2 - LABEL_GAP], [x, y + LABEL_H / 2 + LABEL_GAP]]
          : [[x + width / 2 + LABEL_GAP, y], [x - width / 2 - LABEL_GAP, y]];
        for (const [cx, cy] of spots) {
          const box = { x: cx - width / 2, y: cy - LABEL_H / 2, w: width, h: LABEL_H };
          if (isClear(box)) {
            taken.push(box);
            return { x: cx, y: cy };
          }
        }
      }
    }
    return null;
  }

  function midpoint(path) {
    let best = null;
    for (let i = 0; i < path.length - 1; i += 1) {
      const a = path[i];
      const b = path[i + 1];
      const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (!best || length > best.length) best = { a, b, length };
    }
    return best ? { x: best.a.x + (best.b.x - best.a.x) * 0.2, y: best.a.y + (best.b.y - best.a.y) * 0.2 } : null;
  }

  function pinLabelText(pad) {
    return pad.width > 1 ? `${pad.name}[${pad.width - 1}:0]` : pad.name;
  }

  function netLabelText(link) {
    return link.net;
  }

  // Lays out the whole diagram: block boxes, port positions, net routes, pads and
  // the chip outline.
  function compute(p, frozen) {
    const { blocks, points } = placeBlocks(p, frozen);
    const empty = { blocks, points, routes: [], pads: [], die: null, world: { x: 0, y: 0, w: 600, h: 400 } };
    if (!p.blocks.length) return empty;

    const rects = new Map();
    blocks.forEach((box, id) => rects.set(id, { x: box.x, y: box.y, w: box.w, h: box.h }));
    const boxes = [...rects.values()];
    const minX = Math.min(...boxes.map((b) => b.x));
    const minY = Math.min(...boxes.map((b) => b.y));
    const maxX = Math.max(...boxes.map((b) => b.x + b.w));
    const maxY = Math.max(...boxes.map((b) => b.y + b.h));
    const die = {
      x: minX - DIE_X,
      y: minY - DIE_TOP,
      w: maxX - minX + 2 * DIE_X,
      h: maxY - minY + DIE_TOP + DIE_BOTTOM,
    };

    const lanes = [];
    const labels = [];
    const routes = p.links.map((link) => {
      const a = points.get(link.fromPort);
      const b = points.get(link.toPort);
      if (!a || !b) return null;
      const dir = (point) => (point.side === 'left' ? -1 : 1);
      const path = route(a, dir(a), b, dir(b), rects, lanes, link.net, [link.from, link.to], link.bend);
      recordLanes(path, lanes, link.net);
      return { linkId: link.id, net: link.net, width: link.width, path, mark: midpoint(path) };
    }).filter(Boolean);

    // Pads sit on the chip edge level with their port, spread out if they would touch.
    const pads = [];
    ['left', 'right'].forEach((side) => {
      const list = [...points.values()]
        .filter((point) => point.port.external && point.side === side)
        .sort((a, c) => a.y - c.y);
      let last = -Infinity;
      list.forEach((point) => {
        const y = Math.max(point.y, last + 24);
        last = y;
        const x = side === 'left' ? die.x : die.x + die.w;
        const block = p.blocks.find((b) => b.id === point.blockId);
        const dir = side === 'left' ? -1 : 1;
        const end = { x, y };
        const path = route(point, dir, end, -dir, rects, lanes, point.port.id, [point.blockId]);
        recordLanes(path, lanes, point.port.id);
        pads.push({
          portId: point.port.id, blockId: point.blockId, side, x, y, path,
          name: CS.pinName(block, point.port), width: point.port.width,
        });
      });
    });
    const lowestPad = pads.reduce((y, pad) => Math.max(y, pad.y), -Infinity);
    if (lowestPad + 16 > die.y + die.h) die.h = lowestPad + 16 - die.y;

    // Shared nets get one label, on the route that has room.
    const labelled = new Set();
    const wires = routes.map((r) => r.path).concat(pads.map((pad) => pad.path));
    const marks = routes.filter((r) => r.mark).map((r) => ({ x: r.mark.x - 8, y: r.mark.y - 8, w: 16, h: 16 }));
    routes.forEach((r) => {
      const link = p.links.find((l) => l.id === r.linkId);
      if (labelled.has(r.net)) return;
      const spot = placeLabel(netLabelText(link), r.path, labels, marks, rects, wires, die);
      if (spot) {
        r.label = { x: spot.x, y: spot.y, text: netLabelText(link) };
        labelled.add(r.net);
      }
    });

    const room = (side) => {
      const lengths = pads.filter((x) => x.side === side).map((x) => pinLabelText(x).length);
      return lengths.length ? Math.max(...lengths) * (CHAR_W + 0.6) + PIN_LABEL_GAP : 20;
    };
    const world = {
      x: die.x - room('left'),
      y: die.y - 20,
      w: die.w + room('left') + room('right'),
      h: die.h + 40,
    };
    return { blocks, points, routes, pads, die, world, labels };
  }

  // Arranges blocks left to right: whatever starts requests, then buses, then the
  // blocks they serve. Anything unconnected goes in the first column.
  function tidy(p) {
    if (!p.blocks.length) return;
    // Starting again means forgetting anything that was placed by hand.
    p.links.forEach((l) => { delete l.bend; });
    p.blocks.forEach((b) => b.ports.forEach((x) => { delete x.side; delete x.rank; }));
    const isBus = (id) => CS.roleOf(p.blocks.find((b) => b.id === id)) === 'bus';
    const neighbours = (id, busOnly) => p.links
      .filter((l) => l.from === id || l.to === id)
      .filter((l) => !busOnly || isBus(l.from) || isBus(l.to))
      .map((l) => (l.from === id ? l.to : l.from));
    let roots = p.blocks.filter((b) => CS.roleOf(b) === 'manager').map((b) => b.id);
    if (!roots.length) {
      roots = p.blocks
        .filter((b) => neighbours(b.id).length && !p.links.some((l) => l.to === b.id))
        .map((b) => b.id);
    }
    const column = new Map(roots.map((id) => [id, 0]));
    // Bus connections set the columns first, so that a side wire such as an
    // interrupt cannot pull a peripheral in front of the bus it sits on.
    [true, false].forEach((busOnly) => {
      const queue = [...column.keys()];
      while (queue.length) {
        const id = queue.shift();
        neighbours(id, busOnly).forEach((next) => {
          if (!column.has(next)) {
            column.set(next, column.get(id) + 1);
            queue.push(next);
          }
        });
      }
    });
    p.blocks.forEach((b) => { if (!column.has(b.id)) column.set(b.id, 0); });

    const columns = [];
    p.blocks.forEach((b) => {
      const c = column.get(b.id);
      (columns[c] = columns[c] || []).push(b);
    });
    let x = 0;
    columns.forEach((list) => {
      if (!list) return;
      list.forEach((b) => { b.x = x; });
      x += Math.max(...list.map(blockWidth)) + 230;
    });

    // Heights depend on which side each port faces, and that depends on x, so
    // heights are read only now, after the columns are set.
    const stack = () => {
      const { blocks } = placeBlocks(p);
      const heights = columns.filter(Boolean).map((list) => (
        list.reduce((sum, b) => sum + blocks.get(b.id).h + 60, -60)
      ));
      const tallest = Math.max(...heights);
      columns.filter(Boolean).forEach((list, i) => {
        let y = Math.round((tallest - heights[i]) / 2 / GRID) * GRID;
        list.forEach((b) => {
          b.y = y;
          y += Math.ceil((blocks.get(b.id).h + 60) / GRID) * GRID;
        });
      });
    };
    stack();
  }

  // Records where every port is now, to hold it still during a block drag.
  function freeze(p) {
    const held = new Map();
    placeBlocks(p).blocks.forEach((box) => {
      const counts = { left: 0, right: 0 };
      box.rows.forEach(({ port, side }) => {
        held.set(port.id, { side, row: counts[side] });
        counts[side] += 1;
      });
    });
    return held;
  }

  // The x position a wire's channel takes when it has no offset.
  function channelMiddle(geo, link) {
    const a = geo.points.get(link.fromPort);
    const b = geo.points.get(link.toPort);
    const out = (point) => point.x + (point.side === 'left' ? -STUB : STUB);
    return (out(a) + out(b)) / 2;
  }

  function freeSpotBelow(p) {
    if (!p.blocks.length) return { x: 0, y: 0 };
    const { blocks } = placeBlocks(p);
    const bottom = Math.max(...[...blocks.values()].map((b) => b.y + b.h));
    const left = Math.min(...[...blocks.values()].map((b) => b.x));
    return { x: left, y: Math.ceil((bottom + 40) / GRID) * GRID };
  }

  CS.layout = {
    compute, tidy, freeze, channelMiddle, freeSpotBelow, blockWidth, netLabelText, pinLabelText,
    HEAD, ROW, BLOCK_W, GRID,
  };
}(window.CS));
