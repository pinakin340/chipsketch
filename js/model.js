// Project data: creating it, changing it, and safely loading it from a file.
window.CS = window.CS || {};

(function (CS) {
  'use strict';

  const FORMAT_VERSION = 2;
  // Requires a real string: a JSON array such as ["none"] would otherwise match the key
  // "none" here, and then fail the exact comparisons the checks rely on.
  const has = (table, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key);
  const MAX_NEXT_ID = 2 ** 40; // Far below the point where adding 1 stops working.

  function idIsTaken(p, id) {
    return p.blocks.some((b) => b.id === id || b.ports.some((x) => x.id === id))
      || p.links.some((l) => l.id === id)
      || p.features.some((f) => f.id === id)
      || p.clocks.some((c) => c.id === id);
  }

  // A loaded file may already use ids that this counter would reach, so check each one.
  function nextId(p, prefix) {
    let id;
    do {
      p.nextId += 1;
      id = prefix + p.nextId;
    } while (idIsTaken(p, id));
    return id;
  }

  function roleOf(block) {
    return block.role || typeOf(block).role;
  }

  function typeOf(block) {
    return has(CS.BLOCK_TYPES, block.type) ? CS.BLOCK_TYPES[block.type] : CS.BLOCK_TYPES.custom;
  }

  // Registers take a 4 KB window; a memory takes its own size.
  function sizeBytes(block) {
    return block.type === 'memory' ? block.memKB * 1024 : 4096;
  }

  // Turns free text into a legal RTL name: "Main bus" becomes main_bus.
  function identifier(text, fallback) {
    const clean = String(text).trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (!clean) return fallback || 'unnamed';
    const safe = /^[a-z_]/.test(clean) ? clean : `n_${clean}`;
    return CS.VERILOG_KEYWORDS.has(safe) ? `${safe}_i` : safe;
  }

  function isLegalName(name) {
    return /^[A-Za-z_][A-Za-z0-9_$]*$/.test(name) && !CS.VERILOG_KEYWORDS.has(name);
  }

  function uniqueName(base, taken) {
    if (!taken.includes(base)) return base;
    let n = 2;
    while (taken.includes(`${base}_${n}`)) n += 1;
    return `${base}_${n}`;
  }

  const findBlock = (p, id) => p.blocks.find((b) => b.id === id);
  const findPort = (block, id) => (block ? block.ports.find((x) => x.id === id) : undefined);
  const linksOnPort = (p, portId) => p.links.filter((l) => l.fromPort === portId || l.toPort === portId);

  function addPort(p, block, name, dir, width, external) {
    const port = {
      id: nextId(p, 'p'),
      name: uniqueName(name, block.ports.map((x) => x.name)),
      dir,
      width: width || 1,
      external: !!external,
    };
    block.ports.push(port);
    return port;
  }

  function isFreePort(p, port) {
    return !port.external && !linksOnPort(p, port.id).length;
  }

  // Chooses which ports an unspecified connection uses, and adds a port if none fits.
  // Order: same name on both sides, then bus to bus, then output to input.
  function choosePorts(p, from, to, fromPort, toPort) {
    const drives = (x) => x.dir !== 'in';
    const receives = (x) => x.dir !== 'out';
    const froms = fromPort ? [fromPort] : from.ports.filter((x) => isFreePort(p, x) && drives(x));
    const tos = toPort ? [toPort] : to.ports.filter((x) => isFreePort(p, x) && receives(x));
    const scored = [];
    froms.forEach((a) => tos.forEach((b) => {
      if (a.name === b.name) scored.push([0, a, b]);
      else if (a.dir === 'bus' && b.dir === 'bus') scored.push([1, a, b]);
      else if (a.dir !== 'bus' && b.dir !== 'bus') scored.push([2, a, b]);
    }));
    scored.sort((x, y) => x[0] - y[0]);
    if (scored.length) return { a: scored[0][1], b: scored[0][2] };
    const a = fromPort || froms.find((x) => x.dir !== 'bus')
      || addPort(p, from, `to_${identifier(to.name)}`, 'out', toPort ? toPort.width : 8);
    const b = toPort || tos.find((x) => x.dir !== 'bus')
      || addPort(p, to, `from_${identifier(from.name)}`, 'in', a.width);
    return { a, b };
  }

  function busTap(p, bus, peer, peerPort) {
    let prefix = 's';
    if (peer && roleOf(peer) === 'bus') prefix = 'b';
    else if (peer && (roleOf(peer) === 'manager' || (peerPort && peerPort.name.startsWith('m_')))) prefix = 'm';
    let n = 0;
    while (bus.ports.some((x) => x.name === `${prefix}${n}`)) n += 1;
    return addPort(p, bus, `${prefix}${n}`, 'bus', bus.width);
  }

  function busInterface(p, block, width) {
    return block.ports.find((x) => x.dir === 'bus' && isFreePort(p, x))
      || addPort(p, block, 'bus_if', 'bus', width);
  }

  function defaultNetName(p, from, fromPort, to, bus) {
    const taken = p.links.map((l) => l.net).filter(Boolean);
    const peer = bus && bus === from ? to : from;
    const base = bus ? `${identifier(peer.name)}_bus` : `${identifier(from.name)}_${identifier(fromPort.name)}`;
    return uniqueName(base, taken);
  }

  // Completes a connection: picks ports, width, protocol and net name for whatever is
  // missing. A port that was picked automatically adapts to the net; a port the user
  // chose keeps its width, so that a real mismatch gets flagged by the checks.
  function completeLink(p, draft) {
    const from = findBlock(p, draft.from);
    const to = findBlock(p, draft.to);
    const chosenA = findPort(from, draft.fromPort);
    const chosenB = findPort(to, draft.toPort);
    const fromIsBus = roleOf(from) === 'bus';
    const toIsBus = roleOf(to) === 'bus';
    const bus = fromIsBus ? from : (toIsBus ? to : null);
    let a = chosenA;
    let b = chosenB;
    if (bus) {
      if (!a && !fromIsBus) a = busInterface(p, from, bus.width);
      if (!b && !toIsBus) b = busInterface(p, to, bus.width);
      if (!a) a = busTap(p, from, to, b);
      if (!b) b = busTap(p, to, from, a);
    } else if (!a || !b) {
      ({ a, b } = choosePorts(p, from, to, a, b));
    }
    const width = draft.width !== undefined ? draft.width : (bus ? bus.width : (chosenB && !chosenA ? b.width : a.width));
    if (!chosenA) a.width = width;
    if (!chosenB) b.width = width;

    const link = Object.assign({}, draft);
    // The driver goes first, so that "from" always means the source of the signal.
    const swap = a.dir === 'in' && b.dir === 'out';
    link.from = swap ? to.id : from.id;
    link.to = swap ? from.id : to.id;
    link.fromPort = swap ? b.id : a.id;
    link.toPort = swap ? a.id : b.id;
    link.width = width;
    if (!link.protocol) link.protocol = bus ? bus.protocol : (a.dir === 'bus' && b.dir === 'bus' ? 'axi-lite' : 'wires');
    if (!link.net) {
      const shared = linksOnPort(p, a.id).concat(linksOnPort(p, b.id))[0];
      link.net = shared ? shared.net : defaultNetName(p, swap ? to : from, swap ? b : a, swap ? from : to, bus);
    }
    return link;
  }

  function setLinkWidth(p, link, width) {
    link.width = width;
    [[link.from, link.fromPort], [link.to, link.toPort]].forEach(([blockId, portId]) => {
      const port = findPort(findBlock(p, blockId), portId);
      if (port) port.width = width;
    });
  }

  // Bus taps exist only to serve a connection, so they go when it does.
  function removeLink(p, linkId) {
    const link = p.links.find((l) => l.id === linkId);
    if (!link) return;
    p.links = p.links.filter((l) => l.id !== linkId);
    [[link.from, link.fromPort], [link.to, link.toPort]].forEach(([blockId, portId]) => {
      const block = findBlock(p, blockId);
      if (block && roleOf(block) === 'bus' && !linksOnPort(p, portId).length) {
        block.ports = block.ports.filter((x) => x.id !== portId);
      }
    });
  }

  function removePort(p, block, portId) {
    linksOnPort(p, portId).map((l) => l.id).forEach((id) => removeLink(p, id));
    block.ports = block.ports.filter((x) => x.id !== portId);
  }

  function renameNet(p, oldName, newName) {
    p.links.forEach((l) => { if (l.net === oldName) l.net = newName; });
  }

  const pinName = (block, port) => `${identifier(block.name)}_${port.name}`;

  function createBlock(p, typeKey, x, y, overrides) {
    const type = CS.BLOCK_TYPES[typeKey];
    const sameType = p.blocks.filter((b) => b.type === typeKey).length;
    const block = Object.assign({
      id: nextId(p, 'b'),
      type: typeKey,
      name: sameType ? `${type.label} ${sameType + 1}` : type.label,
      x: x || 0,
      y: y || 0,
      clock: p.clocks[0] ? p.clocks[0].id : null,
      gates: type.gates,
      memKB: type.memKB || 0,
      mbps: type.mbps || 0,
      baseAddr: null,
      power: 'always-on',
      ports: [],
    }, type.role === 'bus' ? { protocol: 'axi-lite', width: 32 } : {}, overrides || {});
    type.ports.forEach((t) => addPort(p, block, t.name, t.dir, t.width, t.external));
    p.blocks.push(block);
    return block;
  }

  function createLink(p, fromId, toId, overrides) {
    const link = completeLink(p, Object.assign({
      id: nextId(p, 'l'),
      from: fromId,
      to: toId,
      crossing: 'none',
      comb: false,
      isolated: false,
    }, overrides || {}));
    p.links.push(link);
    return link;
  }

  function removeBlock(p, blockId) {
    p.links.filter((l) => l.from === blockId || l.to === blockId).map((l) => l.id)
      .forEach((id) => removeLink(p, id));
    p.blocks = p.blocks.filter((b) => b.id !== blockId);
    p.features.forEach((f) => { if (f.blockId === blockId) f.blockId = null; });
  }

  function createFeature(p, title, blockId, extra) {
    const feature = Object.assign(
      { id: nextId(p, 'f'), title, blockId: blockId || null, test: '', status: 'todo', must: true },
      extra || {},
    );
    p.features.push(feature);
    return feature;
  }

  function createProject(name, targetKey, templateKey) {
    const template = has(CS.TEMPLATES, templateKey) ? CS.TEMPLATES[templateKey] : CS.TEMPLATES.blank;
    const target = has(CS.TARGETS, targetKey) ? CS.TARGETS[targetKey] : CS.TARGETS.tt;
    const project = normalize({
      version: FORMAT_VERSION,
      name: name || 'My chip',
      target: has(CS.TARGETS, targetKey) ? targetKey : 'tt',
      limits: {
        areaMm2: target.areaMm2, pins: target.pins, maxMHz: target.maxMHz,
        gateUm2: target.gateUm2, kbUm2: target.kbUm2,
      },
      clocks: template.clocks,
      blocks: template.blocks,
      links: template.links,
      features: template.features.map((f, i) => Object.assign({ id: `tf${i + 1}` }, f)),
    });
    CS.layout.tidy(project);
    return project;
  }

  function num(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max === undefined ? Infinity : max, Math.max(min === undefined ? -Infinity : min, n));
  }

  function str(value, fallback, maxLength) {
    return typeof value === 'string' && value.trim() ? value.slice(0, maxLength || 200) : fallback;
  }

  function list(value) {
    return Array.isArray(value) ? value.filter((v) => v && typeof v === 'object') : [];
  }

  // Fills in defaults and drops anything unusable. Every project passes through
  // here, including hand-edited files, so the rest of the app can trust the shape.
  // Old files stored a pin count. Turn it into ports, so that it is not lost.
  function migratePins(ports, oldPins) {
    const pins = Number(oldPins);
    if (!Number.isFinite(pins)) return ports;
    const bits = () => ports.filter((x) => x.external).reduce((sum, x) => sum + x.width, 0);
    for (let i = ports.length - 1; i >= 0 && bits() > pins; i -= 1) ports[i].external = false;
    if (bits() < pins) ports.push({ name: 'ext', dir: 'inout', width: pins - bits(), external: true });
    return ports;
  }

  function normalize(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('This file is not a ChipSketch project.');
    const isOldFormat = !(Number(raw.version) >= 2);
    const targetKey = has(CS.TARGETS, raw.target) ? raw.target : 'tt';
    const target = CS.TARGETS[targetKey];
    const rawLimits = raw.limits && typeof raw.limits === 'object' ? raw.limits : {};
    const seen = new Set();
    const unique = (id, fallback) => {
      let value = typeof id === 'string' && id && !seen.has(id) ? id : fallback;
      for (let n = 2; seen.has(value); n += 1) value = `${fallback}_${n}`;
      seen.add(value);
      return value;
    };

    const p = {
      version: FORMAT_VERSION,
      name: str(raw.name, 'My chip', 60),
      target: targetKey,
      limits: {
        areaMm2: num(rawLimits.areaMm2, target.areaMm2, 0.0001),
        pins: num(rawLimits.pins, target.pins, 0),
        maxMHz: num(rawLimits.maxMHz, target.maxMHz, 0.001),
        gateUm2: num(rawLimits.gateUm2, target.gateUm2, 0.001),
        kbUm2: num(rawLimits.kbUm2, target.kbUm2, 0.001),
      },
      nextId: Math.max(1000, num(raw.nextId, 1000, 0, MAX_NEXT_ID)),
      clocks: [],
      blocks: [],
      links: [],
      features: [],
      road: raw.road && typeof raw.road === 'object' ? Object.assign({}, raw.road) : {},
      ignored: Array.isArray(raw.ignored) ? raw.ignored.filter((k) => typeof k === 'string') : [],
      skippedSuggestions: Array.isArray(raw.skippedSuggestions)
        ? raw.skippedSuggestions.filter((k) => typeof k === 'string') : [],
    };

    list(raw.clocks).forEach((c, i) => {
      p.clocks.push({
        id: unique(c.id, `cx${i}`),
        name: str(c.name, `clk_${i}`, 40),
        mhz: num(c.mhz, 25, 0.001),
      });
    });
    if (!p.clocks.length) p.clocks.push({ id: unique('c1', 'c1'), name: 'clk', mhz: 25 });
    const clockIds = new Set(p.clocks.map((c) => c.id));

    list(raw.blocks).forEach((b, i) => {
      const typeKey = has(CS.BLOCK_TYPES, b.type) ? b.type : 'custom';
      const type = CS.BLOCK_TYPES[typeKey];
      const block = {
        id: unique(b.id, `bx${i}`),
        type: typeKey,
        name: str(b.name, type.label, 40),
        x: num(b.x, 0),
        y: num(b.y, 0),
        clock: clockIds.has(b.clock) ? b.clock : null,
        gates: num(b.gates, type.gates, 0),
        memKB: num(b.memKB, type.memKB || 0, 0),
        mbps: num(b.mbps, type.mbps || 0, 0),
        baseAddr: b.baseAddr === null || b.baseAddr === undefined ? null : num(b.baseAddr, null, 0),
        power: str(b.power, 'always-on', 40),
      };
      if (type.role === 'bus') {
        block.protocol = has(CS.PROTOCOLS, b.protocol) ? b.protocol : 'axi-lite';
        block.width = num(b.width, 32, 1, 4096);
      }
      if (['manager', 'subordinate', 'both'].includes(b.role) && typeKey === 'custom') block.role = b.role;
      let rawPorts = Array.isArray(b.ports) ? list(b.ports) : type.ports.map((t) => Object.assign({}, t));
      if (isOldFormat && !Array.isArray(b.ports)) rawPorts = migratePins(rawPorts, b.pins);
      block.ports = rawPorts.map((x, j) => {
        const dir = has(CS.PORT_DIRS, x.dir) ? x.dir : 'in';
        return {
          id: unique(x.id, `${block.id}.p${j}`),
          name: str(x.name, `p${j}`, 40),
          dir,
          width: num(x.width, 1, 1, 4096),
          external: x.external === true && dir !== 'bus',
          side: x.side === 'left' || x.side === 'right' ? x.side : undefined,
          rank: Number.isFinite(x.rank) ? x.rank : undefined,
        };
      });
      p.blocks.push(block);
    });
    const blockIds = new Set(p.blocks.map((b) => b.id));

    list(raw.links).forEach((l, i) => {
      if (!blockIds.has(l.from) || !blockIds.has(l.to) || l.from === l.to) return;
      const known = (blockId, portId) => (findPort(findBlock(p, blockId), portId) ? portId : undefined);
      p.links.push(completeLink(p, {
        id: unique(l.id, `lx${i}`),
        from: l.from,
        to: l.to,
        fromPort: known(l.from, l.fromPort),
        toPort: known(l.to, l.toPort),
        protocol: has(CS.PROTOCOLS, l.protocol) ? l.protocol : undefined,
        width: l.width === undefined ? undefined : num(l.width, 8, 1, 4096),
        net: str(l.net, undefined, 60),
        crossing: has(CS.CROSSINGS, l.crossing) ? l.crossing : 'none',
        comb: l.comb === true,
        isolated: l.isolated === true,
        bend: Number.isFinite(l.bend) ? l.bend : undefined,
      }));
    });

    list(raw.features).forEach((f, i) => {
      p.features.push({
        id: unique(f.id, `fx${i}`),
        title: str(f.title, 'Untitled feature', 160),
        blockId: blockIds.has(f.blockId) ? f.blockId : null,
        test: typeof f.test === 'string' ? f.test.slice(0, 300) : '',
        status: ['todo', 'built', 'tested'].includes(f.status) ? f.status : 'todo',
        must: f.must !== false,
        sourceKey: typeof f.sourceKey === 'string' ? f.sourceKey : undefined,
      });
    });

    if (isOldFormat) CS.layout.tidy(p);
    return p;
  }

  // Opening someone's file must not bring their dismissals with it, or a file could
  // hide its own problems. Your own dismissals stay in your autosave and undo history.
  function openProject(raw) {
    const project = normalize(raw);
    const hiddenByFile = project.ignored.length;
    project.ignored = [];
    return { project, hiddenByFile };
  }

  function usage(p) {
    const areaUm2 = p.blocks.reduce(
      (sum, b) => sum + b.gates * p.limits.gateUm2 + b.memKB * p.limits.kbUm2, 0,
    );
    return {
      areaMm2: areaUm2 / 1e6,
      areaShare: areaUm2 / 1e6 / p.limits.areaMm2,
      pins: p.blocks.reduce((sum, b) => sum + b.ports.filter((x) => x.external).reduce((n, x) => n + x.width, 0), 0),
      gates: p.blocks.reduce((sum, b) => sum + b.gates, 0),
    };
  }

  function nextSuggestion(p) {
    for (const block of p.blocks) {
      const texts = typeOf(block).features;
      for (let i = 0; i < texts.length; i += 1) {
        const key = `${block.id}:${i}`;
        const title = `${block.name}: ${texts[i]}`;
        const taken = p.features.some((f) => f.sourceKey === key || f.title === title);
        if (!taken && !p.skippedSuggestions.includes(key)) return { key, title, blockId: block.id };
      }
    }
    return null;
  }

  function formatHex(n) {
    if (n === null || n === undefined) return '';
    const hex = n.toString(16).toUpperCase().padStart(8, '0');
    return `0x${hex.slice(0, 4)}_${hex.slice(4)}`;
  }

  function parseHex(text) {
    const clean = String(text).trim().replace(/_/g, '');
    if (!clean) return null;
    const n = /^0x/i.test(clean) ? parseInt(clean, 16) : Number(clean);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  }

  function safeClockName(name) {
    const clean = name.replace(/[^A-Za-z0-9_]/g, '_');
    return /^[A-Za-z_]/.test(clean) && !CS.VERILOG_KEYWORDS.has(clean) ? clean : `clk_${clean}`;
  }

  // The port name of every clock. Both exports use this, so that they always agree.
  function clockPortNames(p) {
    const taken = [];
    return new Map(p.clocks.map((c) => {
      const name = uniqueName(safeClockName(c.name), taken);
      taken.push(name);
      return [c.id, name];
    }));
  }

  function toSdc(p) {
    const names = clockPortNames(p);
    const clocks = p.clocks.map((c) => ({ name: names.get(c.id), mhz: c.mhz }));
    const lines = [
      `# Timing constraints for ${p.name.replace(/[\r\n]+/g, ' ')}, written by ChipSketch.`,
      '# This is a starting point. Clock ports match the ChipSketch Verilog export.',
      '',
    ];
    clocks.forEach((c) => {
      lines.push(`create_clock -name ${c.name} -period ${(1000 / c.mhz).toFixed(3)} [get_ports ${c.name}]`);
    });
    if (clocks.length > 1) {
      lines.push('');
      lines.push('# Treats every clock as unrelated. Remove this if two clocks share a source.');
      lines.push(`set_clock_groups -asynchronous ${clocks.map((c) => `-group {${c.name}}`).join(' ')}`);
    }
    return `${lines.join('\n')}\n`;
  }

  function toMarkdown(p, issues, hidden) {
    // Project text may come from someone else's file, so it must stay plain text in any
    // Markdown viewer: no HTML, images or links, and no way to break out of a table cell.
    const cell = (text) => String(text)
      .replace(/[\r\n\f\v\u0085\u2028\u2029]+/g, ' ')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\|/g, '&#124;')
      .replace(/[\\`*[\]()!]/g, '\\$&');
    const severityLabel = (i) => (i.severity === 'fix' ? 'Must fix' : i.severity === 'warn' ? 'Worth checking' : 'Tip');
    const blockName = (id) => { const b = p.blocks.find((x) => x.id === id); return b ? b.name : 'Unassigned'; };
    const clockName = (id) => { const c = p.clocks.find((x) => x.id === id); return c ? c.name : 'none'; };
    const use = usage(p);
    const out = [
      `# ${cell(p.name)}`, '',
      `Target: ${CS.TARGETS[p.target].name}. Numbers are rough estimates.`, '',
      `- Size: about ${use.gates.toLocaleString('en-US')} gates and ${use.areaMm2.toFixed(3)} mm² of ${p.limits.areaMm2} mm²`,
      `- Pins: ${use.pins} of ${p.limits.pins}`, '',
      '## Clocks', '', '| Name | MHz |', '| --- | --- |',
      ...p.clocks.map((c) => `| ${cell(c.name)} | ${c.mhz} |`), '',
      '## Blocks', '', '| Name | Kind | Clock | Gates | Memory KB | Address |', '| --- | --- | --- | --- | --- | --- |',
      ...p.blocks.map((b) => `| ${cell(b.name)} | ${typeOf(b).label} | ${cell(clockName(b.clock))} | ${b.gates} | ${b.memKB} | ${formatHex(b.baseAddr)} |`), '',
      '## Ports', '', '| Block | Port | Direction | Bits | Chip pin |', '| --- | --- | --- | --- | --- |',
      ...p.blocks.flatMap((b) => b.ports.map((x) => `| ${cell(b.name)} | ${cell(x.name)} | ${CS.PORT_DIRS[x.dir]} | ${x.width} | ${x.external ? cell(pinName(b, x)) : ''} |`)), '',
      '## Nets', '', '| Net | From | To | Protocol | Bits | Crossing |', '| --- | --- | --- | --- | --- | --- |',
      ...p.links.map((l) => {
        const end = (blockId, portId) => {
          const x = findPort(findBlock(p, blockId), portId);
          return `${blockName(blockId)}.${x ? x.name : '?'}`;
        };
        return `| ${cell(l.net)} | ${cell(end(l.from, l.fromPort))} | ${cell(end(l.to, l.toPort))} | ${CS.PROTOCOLS[l.protocol]} | ${l.width} | ${l.crossing === 'none' ? '' : CS.CROSSINGS[l.crossing]} |`;
      }), '',
      '## Features', '',
      ...p.features.map((f) => `- [${f.status === 'tested' ? 'x' : ' '}] ${cell(f.title)} (${f.must ? 'must have' : 'nice to have'}, ${f.status})${f.test ? `. Test: ${cell(f.test)}` : ''}`), '',
      '## Open problems', '',
      ...(issues.length ? issues.map((i) => `- ${severityLabel(i)}: ${cell(i.plainTitle)}`) : ['None found.']),
      '',
      ...(hidden && hidden.length ? [
        '## Hidden problems', '',
        'These were marked as "Not a problem" in ChipSketch.', '',
        ...hidden.map((i) => `- ${severityLabel(i)}: ${cell(i.plainTitle)}`),
        '',
      ] : []),
    ];
    return out.join('\n');
  }

  Object.assign(CS, {
    createProject, createBlock, createLink, removeBlock, removeLink, removePort, createFeature, normalize, openProject,
    clockPortNames,
    safeClockName, addPort, findPort, linksOnPort, setLinkWidth, renameNet, identifier, isLegalName, uniqueName, pinName,
    roleOf, typeOf, sizeBytes, usage, nextSuggestion, formatHex, parseHex, toSdc, toMarkdown,
  });
}(window.CS));
