// Screens and interaction. All chip knowledge lives in the other files.
(function (CS) {
  'use strict';

  const STORE_KEY = 'chipsketch.project.v1';
  const GRID = CS.layout.GRID;
  const MIN_ZOOM = 0.3;
  const MAX_ZOOM = 2;
  const UNDO_LIMIT = 60;
  const LENSES = [
    ['wiring', 'Wiring'],
    ['clocks', 'Clocks'],
    ['map', 'Memory map'],
  ];
  const TABS = [
    ['sketch', 'Sketch'],
    ['check', 'Check'],
    ['features', 'Features'],
    ['roadmap', 'Roadmap'],
  ];

  const $ = (selector) => document.querySelector(selector);
  const main = $('#main');
  const drawer = $('#drawer');
  const top = $('#top');

  let project = null;
  let screen = 'sketch';
  let viewMode = 'wiring';
  let draggingId = null;
  let frozenPorts = null; // Holds ports still while a block is dragged.
  let selection = null; // {kind:'block'|'link', id}, {kind:'port', blockId, id}, {kind:'settings'} or {kind:'glossary'}
  let undoStack = [];
  let pendingSnapshot = null;
  let view = { x: 40, y: 40, scale: 1 };
  let checkIndex = 0;
  let pickerOpen = false;
  let pickerGroup = 'core';
  let menuOpen = false;
  let confirmNew = false;
  let featureFilter = 'open';
  let openFeature = null;
  let openStage = null;
  let wizard = null;
  let saveTimer = null;
  let toastTimer = null;

  const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  function rich(text) {
    return esc(text).replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, (_, key, label) => (
      Object.prototype.hasOwnProperty.call(CS.GLOSSARY, key)
        ? `<button type="button" class="term" data-act="term" data-arg="${key}">${label}</button>`
        : label
    ));
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const blockById = (id) => project.blocks.find((b) => b.id === id);
  const linkById = (id) => project.links.find((l) => l.id === id);
  const clockColor = (clockId) => {
    const index = project.clocks.findIndex((c) => c.id === clockId);
    return index < 0 ? 'var(--line)' : `var(--c${index % 6})`;
  };
  const options = (pairs, current) => pairs.map(([value, label]) => (
    `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(label)}</option>`
  )).join('');

  /* ---------- Saving and undo ---------- */

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!project) return; // Never replace a saved chip with nothing.
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(project));
      } catch (err) {
        toast('Autosave is not available here. Use the menu to save a file.');
      }
    }, 150);
  }

  function pushUndo(snapshot) {
    undoStack.push(snapshot || JSON.stringify(project));
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  }

  function mutate(change) {
    pushUndo();
    const result = change();
    persist();
    renderAll();
    return result;
  }

  function undo() {
    if (!undoStack.length) return;
    project = CS.normalize(JSON.parse(undoStack.pop()));
    if (selection && selection.kind === 'block' && !blockById(selection.id)) selection = null;
    if (selection && selection.kind === 'link' && !linkById(selection.id)) selection = null;
    if (selection && selection.kind === 'port' && !CS.findPort(blockById(selection.blockId), selection.id)) selection = null;
    persist();
    renderAll();
    toast('Undone');
  }

  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  function download(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const fileStem = () => project.name.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'chip';

  /* ---------- Rendering ---------- */

  function renderAll() {
    renderTop();
    renderMain();
    renderDrawer();
  }

  function renderMain() {
    if (wizard) { renderWizard(); return; }
    if (screen === 'sketch') renderSketch();
    else if (screen === 'check') renderCheck();
    else if (screen === 'features') renderFeatures();
    else renderRoadmap();
  }

  function mustFixCount() {
    return CS.runChecks(project).filter((i) => i.severity === 'fix').length;
  }

  function renderTop() {
    top.hidden = !!wizard;
    if (wizard) return;
    const fixes = mustFixCount();
    top.innerHTML = `
      <button class="chip-name" data-act="settings" title="Chip settings">${esc(project.name)}</button>
      <nav id="tabs">
        ${TABS.map(([id, label]) => `
          <button class="tab" data-act="tab" data-arg="${id}"${screen === id ? ' aria-current="page"' : ''}>
            ${label}${id === 'check' && fixes ? `<span class="badge" aria-label="${plural(fixes, 'problem')} to fix">${fixes}</span>` : ''}
          </button>`).join('')}
      </nav>
      <div class="top-actions">
        <button class="btn quiet" data-act="undo"${undoStack.length ? '' : ' disabled'}>Undo</button>
        <button class="btn quiet" data-act="menu" aria-expanded="${menuOpen}" aria-label="Menu">Menu</button>
        ${menuOpen ? `
          <div class="menu">
            <button data-act="save">Save project file</button>
            <button data-act="open">Open project file</button>
            <hr>
            <button data-act="export-md">Export written spec (.md)</button>
            <button data-act="export-verilog">Export top-level Verilog (.v)</button>
            <button data-act="export-sdc">Export clock constraints (.sdc)</button>
            <hr>
            <button data-act="glossary">Glossary</button>
            <hr>
            <button class="danger" data-act="new">${confirmNew ? 'Click again to replace this chip' : 'Start a new chip'}</button>
          </div>` : ''}
      </div>`;
  }

  /* ---------- Wizard ---------- */

  function startWizard() {
    wizard = { step: 0, name: '', template: 'practice', target: null };
    selection = null;
    renderAll();
    const input = $('#wiz-name');
    if (input) input.focus();
  }

  function renderWizard() {
    const w = wizard;
    const nav = (nextLabel) => `
      <div class="wizard-nav">
        ${w.step ? '<button class="btn quiet" data-act="wiz-back">Back</button>' : `
          <span>
            ${project ? '<button class="btn quiet" data-act="wiz-cancel">Cancel</button>' : ''}
            <button class="btn quiet" data-act="open">Open a saved chip</button>
          </span>`}
        <button class="btn primary" data-act="wiz-next">${nextLabel}</button>
      </div>`;
    let body = '';
    if (w.step === 0) {
      body = `
        <h1>What should we call your chip?</h1>
        <p class="lede">You can change this later.</p>
        <p class="muted small">Your work saves automatically in this browser, without encryption. Other HTML files you open from this computer may be able to read it.</p>
        <input id="wiz-name" class="big-input" maxlength="60" placeholder="My first chip" value="${esc(w.name)}">
        ${nav('Next')}`;
    } else if (w.step === 1) {
      body = `
        <h1>How would you like to start?</h1>
        <div class="options">
          ${Object.entries(CS.TEMPLATES).map(([key, t]) => `
            <button class="option" data-act="wiz-template" data-arg="${key}" aria-pressed="${w.template === key}">
              <strong>${esc(t.name)}</strong>${key === 'practice' ? '<span class="rec">Good first try</span>' : ''}
              <small>${esc(t.blurb)}</small>
            </button>`).join('')}
        </div>
        ${nav('Next')}`;
    } else {
      const recommended = CS.TEMPLATES[w.template].target;
      const chosen = w.target || recommended;
      body = `
        <h1>Where will it be made?</h1>
        <p class="lede">This sets how much space, how many pins and how fast a clock you get.</p>
        <div class="options">
          ${Object.entries(CS.TARGETS).map(([key, t]) => `
            <button class="option" data-act="wiz-target" data-arg="${key}" aria-pressed="${chosen === key}">
              <strong>${esc(t.name)}</strong>${key === recommended ? '<span class="rec">Suggested</span>' : ''}
              <small>${esc(t.blurb)}</small>
            </button>`).join('')}
        </div>
        ${nav('Create my chip')}`;
    }
    main.innerHTML = `
      <div class="wizard">
        <p class="brand">ChipSketch <span class="muted small">· Step ${w.step + 1} of 3</span></p>
        ${body}
      </div>`;
  }

  function finishWizard() {
    const w = wizard;
    project = CS.createProject(w.name.trim() || 'My first chip', w.target || CS.TEMPLATES[w.template].target, w.template);
    wizard = null;
    undoStack = [];
    screen = 'sketch';
    selection = null;
    checkIndex = 0;
    persist();
    renderAll();
    fitView();
    if (w.template === 'practice') toast('This chip has planted mistakes. Open Check to find them.');
  }

  /* ---------- Sketch ---------- */

  function nextHint() {
    if (!project.blocks.length) return { text: 'Choose what your chip needs first. A processor or your own block is a good start.' };
    const lonely = project.blocks.find((b) => (
      CS.roleOf(b) !== 'support' && !project.links.some((l) => l.from === b.id || l.to === b.id)
    ));
    if (lonely) {
      if (project.blocks.length === 1) return { text: `Add another block, so that ${lonely.name} has something to connect to.` };
      return { text: `Next: connect ${lonely.name}. Drag its + button onto another block.` };
    }
    const fixes = mustFixCount();
    if (fixes) return { text: `${plural(fixes, 'problem')} to fix.`, go: 'See what to fix' };
    return { text: 'Everything is connected. Drag anything to move it, or click it to rename it.', go: 'Check my design' };
  }

  function renderSketch() {
    const hint = nextHint();
    const group = Object.entries(CS.BLOCK_TYPES).filter(([, t]) => t.group === pickerGroup);
    const onMap = viewMode === 'map';
    main.innerHTML = `
      <div class="sketch">
        <div class="lens-bar">
          <div class="segment" role="group" aria-label="View">
            ${LENSES.map(([id, label]) => `<button data-act="lens" data-arg="${id}" aria-pressed="${viewMode === id}">${label}</button>`).join('')}
          </div>
          <div class="legend" id="legend"></div>
        </div>
        ${onMap ? '<div class="map-view" id="map"></div>' : `
          <div class="canvas lens-${viewMode}" id="canvas">
            <div id="stage"><svg id="wires" aria-hidden="true"></svg><div id="nodes"></div></div>
            ${project.blocks.length ? '' : `
              <div class="empty-state"><strong>Your chip is empty</strong><span>Add a block to begin.</span></div>`}
          </div>`}
        <div class="foot">
          ${pickerOpen ? `
            <div class="picker">
              <div class="picker-tabs">
                ${CS.BLOCK_GROUPS.map((g) => `<button data-act="picker-group" data-arg="${g.id}" aria-pressed="${g.id === pickerGroup}">${g.label}</button>`).join('')}
              </div>
              ${group.map(([key, t]) => `
                <button class="picker-item" data-act="add-block" data-arg="${key}">
                  <strong>${esc(t.label)}</strong><small>${esc(t.what)}</small>
                </button>`).join('')}
            </div>` : ''}
          <button class="btn primary" data-act="picker">Add block</button>
          <p class="hint">${esc(hint.text)}${hint.go ? ` <button class="link" data-act="tab" data-arg="check">${esc(hint.go)}</button>` : ''}</p>
          ${onMap ? '' : `
            <div class="view-tools">
              <button class="btn quiet" data-act="tidy">Tidy up</button>
              <button class="btn quiet" data-act="fit">Fit to screen</button>
            </div>`}
        </div>
      </div>`;
    renderLegend();
    if (onMap) {
      renderMap();
    } else {
      renderCanvas();
      bindCanvas();
    }
  }

  function renderLegend() {
    const el = $('#legend');
    if (!el) return;
    const items = viewMode === 'clocks'
      ? project.clocks.map((c) => [clockColor(c.id), `${c.name} · ${c.mhz} MHz`])
      : [];
    el.innerHTML = items.map(([color, label]) => (
      `<span class="legend-item"><i style="background:${color}"></i>${esc(label)}</span>`
    )).join('');
  }

  function blockTag(block) {
    const type = CS.typeOf(block);
    if (block.type === 'memory') return `${type.tag} · ${block.memKB} KB`;
    if (CS.roleOf(block) === 'bus') return `${CS.PROTOCOL_TAGS[block.protocol]} · ${block.width}-bit`;
    if (viewMode === 'clocks') {
      const clock = project.clocks.find((c) => c.id === block.clock);
      return clock ? clock.name : 'No clock';
    }
    return type.tag === block.name ? '' : type.tag;
  }

  // The nets to highlight: clock crossings in the Clocks view, or those on what is selected.
  function highlightedLinks() {
    if (viewMode === 'clocks') {
      return new Set(project.links.filter((l) => blockById(l.from).clock !== blockById(l.to).clock).map((l) => l.id));
    }
    if (!selection) return null;
    if (selection.kind === 'link') {
      const link = linkById(selection.id);
      return new Set(project.links.filter((l) => link && l.net === link.net).map((l) => l.id));
    }
    if (selection.kind === 'port') return new Set(CS.linksOnPort(project, selection.id).map((l) => l.id));
    if (selection.kind === 'block') {
      return new Set(project.links.filter((l) => l.from === selection.id || l.to === selection.id).map((l) => l.id));
    }
    return null;
  }

  const pathData = (path) => path.map((pt, i) => `${i ? 'L' : 'M'}${pt.x} ${pt.y}`).join(' ');

  function renderWires(geo) {
    const svg = $('#wires');
    if (!svg) return;
    if (!geo.die) { svg.innerHTML = ''; return; }
    const lit = highlightedLinks();
    const lens = viewMode !== 'wiring';
    const { die } = geo;
    const selectedPort = selection && selection.kind === 'port' ? selection.id : null;

    const pads = geo.pads.map((pad) => {
      const size = 10;
      const outward = pad.side === 'left' ? -1 : 1;
      const label = CS.layout.pinLabelText(pad);
      return `
        <path class="wire pin-wire${pad.width > 1 ? ' multi' : ''}${lens ? ' dim' : ''}" d="${pathData(pad.path)}"></path>
        <rect class="pad${selectedPort === pad.portId ? ' selected' : ''}" data-pad="${esc(pad.portId)}" data-block="${esc(pad.blockId)}"
              x="${pad.x - size / 2}" y="${pad.y - size / 2}" width="${size}" height="${size}"><title>Chip pin ${esc(pad.name)}</title></rect>
        <text class="pin-name${lens ? ' lens-hide' : ''}" x="${pad.x + outward * 12}" y="${pad.y}" text-anchor="${pad.side === 'left' ? 'end' : 'start'}">${esc(label)}</text>`;
    }).join('');

    const nets = geo.routes.map((r) => {
      const link = linkById(r.linkId);
      const a = blockById(link.from);
      const b = blockById(link.to);
      const on = lit && lit.has(link.id);
      const dim = lens && !on; // Only the Clocks view dims wires; selecting just highlights.
      const d = pathData(r.path);
      const crosses = a.clock && b.clock && a.clock !== b.clock;
      const unsafe = link.crossing === 'none' || (link.crossing === '2ff' && link.width > 1);
      const showMark = crosses && r.mark;
      const showLabel = r.label && !(lens && !on);
      return `
        <path class="wire${link.width > 1 ? ' multi' : ''}${on ? ' on' : ''}${dim ? ' dim' : ''}" d="${d}"></path>
        <path class="wire-hit" data-link="${esc(link.id)}" d="${d}"><title>${esc(link.net)}, ${plural(link.width, 'wire')}. Drag to move, or click to rename.</title></path>
        ${showLabel ? `<text class="net-label${on ? ' on' : ''}${dim ? ' dim' : ''}" data-link="${esc(link.id)}" x="${r.label.x}" y="${r.label.y}">${esc(r.label.text)}</text>` : ''}
        ${showMark ? `<circle class="wire-mark ${unsafe ? 'bad' : 'ok'}" cx="${r.mark.x}" cy="${r.mark.y}" r="5.5"><title>${unsafe ? 'Unsafe clock crossing' : 'Clock crossing'}</title></circle>` : ''}`;
    }).join('');

    svg.innerHTML = `
      <rect class="die" x="${die.x}" y="${die.y}" width="${die.w}" height="${die.h}"></rect>
      <text class="die-title" x="${die.x + 12}" y="${die.y + 20}">${esc(project.name)}</text>
      ${pads}${nets}`;
  }

  function renderCanvas() {
    const nodes = $('#nodes');
    if (!nodes) return;
    const geo = CS.layout.compute(project, frozenPorts);
    const issues = CS.runChecks(project);
    nodes.innerHTML = project.blocks.map((b) => {
      const box = geo.blocks.get(b.id);
      const selected = selection && selection.kind === 'block' && selection.id === b.id;
      const alert = issues.some((i) => i.severity === 'fix'
        && ((i.target.kind === 'block' && i.target.id === b.id) || (i.target.kind === 'port' && i.target.blockId === b.id)));
      const tint = viewMode === 'clocks' ? clockColor(b.clock) : null;
      const tag = blockTag(b);
      const sides = new Set(box.rows.map((row) => row.side));
      const rows = box.rows.map(({ port, side, offset }) => {
        // A bus shows its width once, in its title, so its taps stay short.
        const range = port.width > 1 && CS.roleOf(b) !== 'bus' ? `<em>[${port.width - 1}:0]</em>` : '';
        const on = selection && selection.kind === 'port' && selection.id === port.id;
        return `
          <span class="pt ${side} dir-${port.dir}${on ? ' selected' : ''}${sides.size === 1 ? ' roomy' : ''}" data-port="${esc(port.id)}" style="top:${offset}px"
                title="${esc(port.name)}: ${esc(CS.PORT_DIRS[port.dir])}. Drag to move, or click to rename.">
            <i class="pin"></i><span class="pname">${esc(port.name)}${range}</span>
          </span>`;
      }).join('');
      return `
        <div class="node kind-${esc(b.type)}${selected ? ' selected' : ''}${tint ? ' tinted' : ''}${draggingId === b.id ? ' dragging' : ''}"
             data-block="${esc(b.id)}" tabindex="0" role="button"
             style="left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;${tint ? `--tint:${tint};` : ''}"
             aria-label="${esc(b.name)}, ${esc(CS.typeOf(b).label)}, ${plural(b.ports.length, 'port')}">
          <div class="node-head">
            <strong>${esc(b.name)}</strong>
            ${tag ? `<small>${esc(tag)}</small>` : ''}
            ${alert ? '<span class="alert" title="Has a problem to fix"></span>' : ''}
          </div>
          ${rows}
          <span class="add-wire" data-connect="${esc(b.id)}" title="Drag onto another block to connect">+</span>
        </div>`;
    }).join('');
    renderWires(geo);
    applyView();
  }

  function renderMap() {
    const el = $('#map');
    if (!el) return;
    const blocks = CS.addressable(project);
    if (!blocks.length) {
      el.innerHTML = `
        <div class="map-empty">
          <h2>No address map yet</h2>
          <p class="muted">Connect a memory or peripheral to a ${rich('[[bus|bus]]')}, and it appears here.</p>
        </div>`;
      return;
    }
    const size = (bytes) => {
      const units = [[1073741824, 'GB'], [1048576, 'MB'], [1024, 'KB']];
      const [scale, unit] = units.find(([n]) => bytes >= n) || [1, 'bytes'];
      return `${Number((bytes / scale).toFixed(1))} ${unit}`;
    };
    const placed = blocks.filter((b) => b.baseAddr !== null).sort((a, b) => a.baseAddr - b.baseAddr);
    const waiting = blocks.filter((b) => b.baseAddr === null);
    let end = 0;
    const rows = placed.map((b, i) => {
      const bytes = CS.sizeBytes(b);
      const clash = i > 0 && b.baseAddr < end;
      const gap = i > 0 && b.baseAddr > end;
      const row = `
        ${gap ? `<div class="map-gap">Unused · ${size(b.baseAddr - end)}</div>` : ''}
        <button class="map-row${clash ? ' clash' : ''}" data-act="select-block" data-arg="${esc(b.id)}">
          <code>${CS.formatHex(b.baseAddr)}</code>
          <span>${esc(b.name)}${clash ? ' <small>overlaps the block above</small>' : ''}</span>
          <span class="muted">${size(bytes)}</span>
        </button>`;
      end = Math.max(end, b.baseAddr + bytes);
      return row;
    }).join('');
    el.innerHTML = `
      <div class="map-page">
        <h2>Address map</h2>
        <p class="muted small">Where each block sits when the processor reads or writes an ${rich('[[address|address]]')}.</p>
        <div class="map-list">${rows}</div>
        ${waiting.length ? `
          <p class="small"><strong>No address yet:</strong> ${esc(waiting.map((b) => b.name).join(', '))}</p>` : ''}
        ${waiting.length || placed.some((b, i) => i > 0 && b.baseAddr < placed[i - 1].baseAddr + CS.sizeBytes(placed[i - 1])) ? `
          <div><button class="btn primary" data-act="auto-addresses">Assign addresses for me</button></div>` : ''}
      </div>`;
  }

  function applyView() {
    const stage = $('#stage');
    if (stage) stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    const canvas = $('#canvas');
    // When zoomed out, names would be too small to read, so they step aside.
    if (canvas) canvas.classList.toggle('far', view.scale < 0.5);
  }

  function fitView() {
    const canvas = $('#canvas');
    if (!canvas || !project.blocks.length) { view = { x: 40, y: 40, scale: 1 }; applyView(); return; }
    const box = canvas.getBoundingClientRect();
    const { world } = CS.layout.compute(project);
    const scale = Math.max(MIN_ZOOM, Math.min(1, box.width / world.w, box.height / world.h));
    view = {
      scale,
      x: (box.width - world.w * scale) / 2 - world.x * scale,
      y: (box.height - world.h * scale) / 2 - world.y * scale,
    };
    applyView();
  }

  function zoomAt(clientX, clientY, factor) {
    const canvas = $('#canvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.scale * factor));
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    view.x = px - (px - view.x) * (scale / view.scale);
    view.y = py - (py - view.y) * (scale / view.scale);
    view.scale = scale;
    applyView();
  }

  function centerOn(block) {
    const canvas = $('#canvas');
    if (!canvas || !block) return;
    const rect = canvas.getBoundingClientRect();
    const box = CS.layout.compute(project).blocks.get(block.id);
    view.x = rect.width / 2 - (box.x + box.w / 2) * view.scale;
    view.y = rect.height / 2 - (box.y + box.h / 2) * view.scale;
    applyView();
  }

  function freeSpot() {
    const canvas = $('#canvas');
    const rect = canvas ? canvas.getBoundingClientRect() : { width: 800, height: 500 };
    const startX = Math.round((rect.width / 3 - view.x) / view.scale / GRID) * GRID;
    const startY = Math.round((rect.height / 4 - view.y) / view.scale / GRID) * GRID;
    const boxes = [...CS.layout.compute(project).blocks.values()];
    const w = CS.layout.BLOCK_W;
    const h = 160;
    const margin = 40;
    const hits = (x, y) => boxes.some((b) => (
      x < b.x + b.w + margin && b.x < x + w + margin && y < b.y + b.h + margin && b.y < y + h + margin
    ));
    for (let row = 0; row < 40; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        const x = startX + col * (w + 100);
        const y = startY + row * (h + 40);
        if (!hits(x, y)) return { x, y };
      }
    }
    return { x: startX, y: startY };
  }

  function bindCanvas() {
    const canvas = $('#canvas');
    canvas.addEventListener('pointerdown', onCanvasPointerDown);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 1 / 1.1);
    }, { passive: false });
    canvas.addEventListener('keydown', (e) => {
      const node = e.target.closest && e.target.closest('.node');
      if (node && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        select({ kind: 'block', id: node.dataset.block });
      }
    });
  }

  function onCanvasPointerDown(e) {
    if (e.button !== 0) return;
    pickerOpen = false;
    if ($('.picker')) $('.picker').remove();
    const handle = e.target.closest('.add-wire');
    const port = e.target.closest('.pt');
    const pad = e.target.closest('.pad');
    const node = e.target.closest('.node');
    const wire = e.target.closest('[data-link]');
    if (handle) { startConnect(e, handle.dataset.connect); return; }
    if (port) { startPortDrag(e, node.dataset.block, port.dataset.port); return; }
    if (pad) { select({ kind: 'port', blockId: pad.dataset.block, id: pad.dataset.pad }); return; }
    if (node) { startDrag(e, node.dataset.block); return; }
    if (wire) { startWireDrag(e, wire.dataset.link); return; }
    startPan(e);
  }

  // Every drag follows the pointer until release, even outside the window.
  function track(e, onMove, onUp) {
    const canvas = $('#canvas');
    try {
      if (canvas) canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      // Capture is only an extra safeguard, so the drag still works without it.
    }
    const moveHandler = (ev) => onMove(ev);
    const upHandler = (ev) => {
      document.removeEventListener('pointermove', moveHandler);
      document.removeEventListener('pointerup', upHandler);
      document.removeEventListener('pointercancel', upHandler);
      onUp(ev);
    };
    document.addEventListener('pointermove', moveHandler);
    document.addEventListener('pointerup', upHandler);
    document.addEventListener('pointercancel', upHandler);
    e.preventDefault();
  }

  function worldPoint(ev) {
    const rect = $('#canvas').getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left - view.x) / view.scale,
      y: (ev.clientY - rect.top - view.y) / view.scale,
    };
  }

  // Drag a port up, down, or across to the block's other side.
  function startPortDrag(e, blockId, portId) {
    const block = blockById(blockId);
    const port = CS.findPort(block, portId);
    const snapshot = JSON.stringify(project);
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    track(e, (ev) => {
      if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 5) return;
      moved = true;
      const point = worldPoint(ev);
      const box = CS.layout.compute(project).blocks.get(blockId);
      const side = point.x < box.x + box.w / 2 ? 'left' : 'right';
      const others = box.rows.filter((row) => row.side === side && row.port.id !== portId).map((row) => row.port);
      const row = Math.round((point.y - box.y - CS.layout.HEAD - CS.layout.ROW / 2) / CS.layout.ROW);
      const index = Math.max(0, Math.min(others.length, row));
      others.splice(index, 0, port);
      port.side = side;
      others.forEach((x, i) => { x.rank = i; });
      renderCanvas();
    }, () => {
      if (moved) {
        pushUndo(snapshot);
        persist();
        renderTop();
      } else {
        select({ kind: 'port', blockId, id: portId });
      }
    });
  }

  // Drag a wire sideways to move its vertical run.
  function startWireDrag(e, linkId) {
    const link = linkById(linkId);
    const geo = CS.layout.compute(project);
    const { path } = geo.routes.find((r) => r.linkId === linkId);
    const run = path.find((pt, i) => i < path.length - 1 && pt.x === path[i + 1].x && pt.y !== path[i + 1].y);
    const start = worldPoint(e);
    // Start from where the wire is drawn, so that it does not jump on the first move.
    const startOffset = run ? run.x - CS.layout.channelMiddle(geo, link) : (link.bend || 0);
    const snapshot = JSON.stringify(project);
    const startX = e.clientX;
    let moved = false;
    track(e, (ev) => {
      if (!moved && Math.abs(ev.clientX - startX) < 5) return;
      moved = true;
      const point = worldPoint(ev);
      link.bend = Math.round((startOffset + point.x - start.x) / 10) * 10;
      renderCanvas();
    }, () => {
      if (moved) {
        pushUndo(snapshot);
        persist();
        renderTop();
      } else {
        select({ kind: 'link', id: linkId });
      }
    });
  }

  function startPan(e) {
    const canvas = $('#canvas');
    const startX = e.clientX;
    const startY = e.clientY;
    const original = { x: view.x, y: view.y };
    let moved = false;
    canvas.classList.add('panning');
    track(e, (ev) => {
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 3) moved = true;
      view.x = original.x + ev.clientX - startX;
      view.y = original.y + ev.clientY - startY;
      applyView();
    }, () => {
      canvas.classList.remove('panning');
      if (!moved && selection) select(null);
    });
  }

  function startDrag(e, blockId) {
    const block = blockById(blockId);
    const startX = e.clientX;
    const startY = e.clientY;
    const original = { x: block.x, y: block.y };
    const snapshot = JSON.stringify(project);
    let moved = false;
    track(e, (ev) => {
      const dx = (ev.clientX - startX) / view.scale;
      const dy = (ev.clientY - startY) / view.scale;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      moved = true;
      draggingId = blockId;
      if (!frozenPorts) frozenPorts = CS.layout.freeze(project);
      block.x = Math.round((original.x + dx) / GRID) * GRID;
      block.y = Math.round((original.y + dy) / GRID) * GRID;
      renderCanvas();
    }, () => {
      draggingId = null;
      frozenPorts = null; // Ports settle into their best sides on release, not mid-drag.
      if (moved) {
        pushUndo(snapshot);
        persist();
        renderTop();
        renderCanvas();
      } else {
        select({ kind: 'block', id: blockId });
      }
    });
  }

  // Drag a block's + button onto another block, or onto one of its ports.
  function startConnect(e, fromId) {
    const svg = $('#wires');
    const box = CS.layout.compute(project).blocks.get(fromId);
    const start = { x: box.x + box.w / 2, y: box.y + box.h };
    const temp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    temp.setAttribute('class', 'wire temp');
    svg.append(temp);
    let dropNode = null;
    const nodeAt = (ev) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const node = el && el.closest('.node');
      return node && node.dataset.block !== fromId ? { node, port: el.closest('.pt') } : null;
    };
    track(e, (ev) => {
      const point = worldPoint(ev);
      temp.setAttribute('d', `M${start.x} ${start.y} L${point.x} ${point.y}`);
      const over = nodeAt(ev);
      const overNode = over ? over.node : null;
      if (dropNode !== overNode) {
        if (dropNode) dropNode.classList.remove('drop-target');
        if (overNode) overNode.classList.add('drop-target');
        dropNode = overNode;
      }
    }, (ev) => {
      const target = nodeAt(ev);
      temp.remove();
      if (dropNode) dropNode.classList.remove('drop-target');
      if (target) {
        connect(fromId, target.node.dataset.block, {
          toPort: target.port ? target.port.dataset.port : undefined,
        });
      }
    });
  }

  function connect(fromId, toId, chosen) {
    if (fromId === toId) return;
    const ports = chosen || {};
    if (ports.fromPort && ports.toPort) {
      const pair = [ports.fromPort, ports.toPort];
      if (project.links.some((l) => pair.includes(l.fromPort) && pair.includes(l.toPort))) {
        toast('These ports are already connected.');
        return;
      }
    }
    const link = mutate(() => {
      // A port wired to another block no longer leaves the chip.
      [[fromId, ports.fromPort], [toId, ports.toPort]].forEach(([blockId, portId]) => {
        const port = CS.findPort(blockById(blockId), portId);
        if (port) port.external = false;
      });
      return CS.createLink(project, fromId, toId, ports);
    });
    const a = blockById(link.from);
    const b = blockById(link.to);
    if (a.clock && b.clock && a.clock !== b.clock) select({ kind: 'link', id: link.id });
  }

  function select(next) {
    selection = next;
    if (screen === 'sketch') renderCanvas();
    renderDrawer();
    if (screen === 'sketch' && next && next.kind === 'block') keepVisible(next.id);
    if (screen === 'sketch' && next && next.kind === 'port') keepVisible(next.blockId);
  }

  function keepVisible(blockId) {
    const canvas = $('#canvas');
    if (!canvas) return;
    const box = CS.layout.compute(project).blocks.get(blockId);
    if (!box) return;
    const margin = 24;
    const width = canvas.getBoundingClientRect().width;
    const right = view.x + (box.x + box.w) * view.scale;
    const left = view.x + box.x * view.scale;
    if (right > width - margin) view.x -= right - width + margin;
    else if (left < margin) view.x += margin - left;
    applyView();
  }

  /* ---------- Drawer ---------- */

  function renderDrawer() {
    if (wizard || !selection) { drawer.hidden = true; drawer.innerHTML = ''; return; }
    const block = selection.kind === 'block' && blockById(selection.id);
    const link = selection.kind === 'link' && linkById(selection.id);
    const portBlock = selection.kind === 'port' && blockById(selection.blockId);
    const port = portBlock && CS.findPort(portBlock, selection.id);
    let html = '';
    if (block) html = blockDrawer(block);
    else if (link) html = linkDrawer(link);
    else if (port) html = portDrawer(portBlock, port);
    else if (selection.kind === 'settings') html = settingsDrawer();
    else if (selection.kind === 'glossary') html = glossaryDrawer();
    else { selection = null; drawer.hidden = true; return; }
    drawer.innerHTML = html;
    drawer.hidden = false;
  }

  const drawerHead = (kind) => `
    <div class="drawer-head">
      <span class="kind">${esc(kind)}</span>
      <button class="btn quiet" data-act="close-drawer">Close</button>
    </div>`;

  function clockOptions(selected) {
    return options(project.clocks.map((c) => [c.id, `${c.name} (${c.mhz} MHz)`]), selected);
  }

  function portSummary(block, port) {
    const links = CS.linksOnPort(project, port.id);
    if (port.external) return 'chip pin';
    if (!links.length) return 'not connected';
    const other = links[0].from === block.id ? links[0].to : links[0].from;
    const peer = blockById(other);
    const more = links.length > 1 ? ` +${links.length - 1}` : '';
    return `${peer ? peer.name : ''}${more}`;
  }

  function blockDrawer(b) {
    const type = CS.typeOf(b);
    const role = CS.roleOf(b);
    const others = project.blocks.filter((x) => x.id !== b.id && !project.links.some(
      (l) => (l.from === b.id && l.to === x.id) || (l.to === b.id && l.from === x.id),
    ));
    return `
      ${drawerHead(type.label)}
      <input class="title-input" data-field="block.name" value="${esc(b.name)}" maxlength="40" aria-label="Block name">
      <p class="muted small">${esc(type.what)}</p>
      <div class="field">
        <span class="field-label"><button type="button" class="term" data-act="term" data-arg="port">Ports</button></span>
        <div class="port-list">
          ${b.ports.map((x) => `
            <button class="port-row" data-act="select-port" data-arg="${esc(x.id)}">
              <code>${esc(x.name)}${x.width > 1 ? `[${x.width - 1}:0]` : ''}</code>
              <small>${esc(portSummary(b, x))}</small>
            </button>`).join('') || '<p class="muted small">Ports appear here as you connect blocks.</p>'}
        </div>
        <button class="link small" style="align-self:flex-start;margin-top:4px" data-act="add-port">Add a port</button>
      </div>
      <label class="field"><span>Clock</span>
        <select data-field="block.clock">
          ${b.clock ? '' : '<option value="" selected>No clock</option>'}
          ${clockOptions(b.clock)}
          <option value="__new">Add another clock…</option>
        </select>
      </label>
      ${b.type === 'memory' ? `
        <label class="field"><span>Memory size (KB)</span>
          <input type="number" min="0" step="1" data-field="block.memKB" value="${b.memKB}">
        </label>` : `
        <label class="field"><span>Rough size (<button type="button" class="term" data-act="term" data-arg="gate">gates</button>)</span>
          <input type="number" min="0" step="100" data-field="block.gates" value="${b.gates}">
        </label>`}
      ${others.length ? `
        <label class="field"><span>Connect to</span>
          <select data-field="block.connect">
            <option value="">Choose a block…</option>
            ${options(others.map((x) => [x.id, x.name]), null)}
          </select>
        </label>` : ''}
      <details>
        <summary>More options</summary>
        <div class="stack">
          ${role === 'bus' ? `
            <label class="field"><span>Bus width (bits)</span>
              <input type="number" min="1" step="8" data-field="block.width" value="${b.width}">
            </label>
            <label class="field"><span>Protocol</span>
              <select data-field="block.protocol">${options(Object.entries(CS.PROTOCOLS).filter(([k]) => k !== 'wires'), b.protocol)}</select>
            </label>` : ''}
          ${type.addr ? `
            <label class="field"><span>Start <button type="button" class="term" data-act="term" data-arg="address">address</button> (used when on a bus)</span>
              <input data-field="block.baseAddr" value="${esc(CS.formatHex(b.baseAddr))}" placeholder="0x1000_0000" spellcheck="false">
            </label>` : ''}
          ${role !== 'bus' ? `
            <label class="field"><span>Data it moves over a bus (MB/s)</span>
              <input type="number" min="0" data-field="block.mbps" value="${b.mbps}">
            </label>` : ''}
          ${b.type === 'memory' ? `
            <label class="field"><span>Extra logic (gates)</span>
              <input type="number" min="0" step="100" data-field="block.gates" value="${b.gates}">
            </label>` : ''}
        </div>
      </details>
      <div class="drawer-end"><button class="btn quiet danger-btn" data-act="delete-block">Delete block</button></div>`;
  }

  function portDrawer(block, port) {
    const links = CS.linksOnPort(project, port.id);
    const others = project.blocks.filter((x) => x.id !== block.id);
    const canBePin = port.dir !== 'bus' && !links.length;
    return `
      ${drawerHead('Port')}
      <button class="link small" style="align-self:flex-start" data-act="select-block" data-arg="${esc(block.id)}">Back to ${esc(block.name)}</button>
      <input class="title-input mono" data-field="port.name" value="${esc(port.name)}" maxlength="40" aria-label="Port name" spellcheck="false">
      <label class="field"><span>Direction</span>
        <select data-field="port.dir">${options(Object.entries(CS.PORT_DIRS), port.dir)}</select>
      </label>
      <label class="field"><span>Number of wires (bits)</span>
        <input type="number" min="1" data-field="port.width" value="${port.width}">
      </label>
      <label class="check-row">
        <input type="checkbox" data-field="port.external"${port.external ? ' checked' : ''}${canBePin ? '' : ' disabled'}>
        <span>Goes to a chip ${rich('[[pad|pin]]')}</span>
      </label>
      ${port.external ? `<p class="muted small">Pin name: <code>${esc(CS.pinName(block, port))}</code></p>` : ''}
      ${links.length ? `
        <div class="field">
          <span class="field-label">${rich('[[net|Net]]')}</span>
          <div class="port-list">
            ${links.map((l) => {
              const other = blockById(l.from === block.id ? l.to : l.from);
              return `
                <button class="port-row" data-act="select-link" data-arg="${esc(l.id)}">
                  <code>${esc(l.net)}</code><small>${esc(other ? other.name : '')}</small>
                </button>`;
            }).join('')}
          </div>
        </div>` : ''}
      ${port.external || !others.length ? '' : `
        <label class="field"><span>Connect to</span>
          <select data-field="port.connect">
            <option value="">Choose a block…</option>
            ${options(others.map((x) => [x.id, x.name]), null)}
          </select>
        </label>`}
      <div class="drawer-end"><button class="btn quiet danger-btn" data-act="delete-port">Delete port</button></div>`;
  }

  function linkDrawer(l) {
    const a = blockById(l.from);
    const b = blockById(l.to);
    const crosses = a.clock && b.clock && a.clock !== b.clock;
    const portName = (block, id) => {
      const port = CS.findPort(block, id);
      return `${block.name}.${port ? port.name : '?'}`;
    };
    return `
      ${drawerHead('Net')}
      <input class="title-input mono" data-field="link.net" value="${esc(l.net)}" maxlength="60" aria-label="Net name" spellcheck="false">
      <p class="muted small">Connections with the same name are one ${rich('[[net|net]]')}.</p>
      <p class="small"><code>${esc(portName(a, l.fromPort))}</code> to <code>${esc(portName(b, l.toPort))}</code></p>
      <label class="field"><span>Number of wires (bits)</span>
        <input type="number" min="1" data-field="link.width" value="${l.width}">
      </label>
      ${crosses ? `
        <label class="field"><span>How does it cross between clocks?</span>
          <select data-field="link.crossing">${options(Object.entries(CS.CROSSINGS), l.crossing)}</select>
        </label>
        <p class="muted small">These blocks run on different clocks, so this is a ${rich('[[cdc|clock crossing]]')}.</p>` : ''}
      <div class="drawer-end"><button class="btn quiet danger-btn" data-act="delete-link">Delete connection</button></div>`;
  }

  function metersHtml() {
    const use = CS.usage(project);
    const areaPct = Math.round(use.areaShare * 100);
    const pinShare = project.limits.pins ? use.pins / project.limits.pins : (use.pins ? 2 : 0);
    const state = (share) => (share > 1 ? ' over' : share > 0.8 ? ' near' : '');
    const width = (share) => Math.min(100, Math.round(share * 100));
    return `
      <div class="meter">
        <div class="meter-label"><span>Space used (estimate)</span><span>${areaPct}%</span></div>
        <div class="bar${state(use.areaShare)}"><i style="width:${width(use.areaShare)}%"></i></div>
      </div>
      <div class="meter">
        <div class="meter-label"><span>Pins used</span><span>${use.pins} of ${project.limits.pins}</span></div>
        <div class="bar${state(pinShare)}"><i style="width:${width(pinShare)}%"></i></div>
      </div>`;
  }

  function settingsDrawer() {
    const lim = project.limits;
    return `
      ${drawerHead('Chip settings')}
      <label class="field"><span>Name</span>
        <input data-field="project.name" value="${esc(project.name)}" maxlength="60">
      </label>
      <label class="field"><span>Where it will be made</span>
        <select data-field="project.target">${options(Object.entries(CS.TARGETS).map(([k, t]) => [k, t.name]), project.target)}</select>
      </label>
      <div class="stack" id="meters">${metersHtml()}</div>
      <div class="field">
        <span class="field-label">Clocks</span>
        <div class="stack" style="gap:6px">
          ${project.clocks.map((c) => `
            <div class="clock-row" style="--stripe:${clockColor(c.id)}">
              <span class="clock-dot"></span>
              <input data-field="clock.name" data-id="${esc(c.id)}" value="${esc(c.name)}" maxlength="40" aria-label="Clock name">
              <input type="number" min="0.001" data-field="clock.mhz" data-id="${esc(c.id)}" value="${c.mhz}" aria-label="${esc(c.name)} speed in MHz" title="Speed in MHz">
              <button class="icon-btn" data-act="delete-clock" data-arg="${esc(c.id)}" aria-label="Delete ${esc(c.name)}"${project.clocks.length < 2 ? ' disabled' : ''}>✕</button>
            </div>`).join('')}
        </div>
        <button class="link small" style="align-self:flex-start;margin-top:4px" data-act="add-clock">Add a clock</button>
      </div>
      <details>
        <summary>Budgets and estimates</summary>
        <div class="stack">
          <p class="muted small">These are rough starting values. Change them if you know better.</p>
          <label class="field"><span>Available space (mm²)</span><input type="number" min="0" step="any" data-field="limit.areaMm2" value="${lim.areaMm2}"></label>
          <label class="field"><span>Available pins</span><input type="number" min="0" data-field="limit.pins" value="${lim.pins}"></label>
          <label class="field"><span>Fastest clock (MHz)</span><input type="number" min="0" step="any" data-field="limit.maxMHz" value="${lim.maxMHz}"></label>
          <label class="field"><span>Space per gate (µm²)</span><input type="number" min="0" step="any" data-field="limit.gateUm2" value="${lim.gateUm2}"></label>
          <label class="field"><span>Space per KB of memory (µm²)</span><input type="number" min="0" step="any" data-field="limit.kbUm2" value="${lim.kbUm2}"></label>
        </div>
      </details>`;
  }

  function glossaryDrawer() {
    const entries = Object.entries(CS.GLOSSARY).sort(([a], [b]) => a.localeCompare(b));
    return `
      ${drawerHead('Glossary')}
      <dl class="glossary">
        ${entries.map(([key, text]) => `<div><dt>${esc(termLabel(key))}</dt><dd>${esc(text)}</dd></div>`).join('')}
      </dl>`;
  }

  function termLabel(key) {
    const labels = {
      rtl: 'RTL', cdc: 'Clock crossing (CDC)', clockdomain: 'Clock domain', combloop: 'Combinational loop',
      sta: 'Timing analysis (STA)', pnr: 'Place and route', dft: 'Design for test (DFT)', drc: 'DRC', lvs: 'LVS',
      gds: 'GDS', tapeout: 'Tape-out', powerdomain: 'Power domain', levelshifter: 'Level shifter', sdc: 'SDC file', fifo: 'FIFO',
    };
    return labels[key] || key;
  }

  function applyField(el, finished) {
    const field = el.dataset.field;
    const value = el.type === 'checkbox' ? el.checked : el.value;
    const number = Number(value);
    const validNumber = value !== '' && Number.isFinite(number) && number >= 0;
    const [scope, prop] = field.split('.');
    const block = selection && selection.kind === 'block' ? blockById(selection.id) : null;
    const link = selection && selection.kind === 'link' ? linkById(selection.id) : null;

    if (scope === 'block' && block) {
      if (prop === 'name') {
        if (value.trim()) block.name = value;
        else if (finished) el.value = block.name;
      } else if (['gates', 'memKB', 'mbps'].includes(prop)) {
        if (validNumber) block[prop] = number;
      } else if (prop === 'width') {
        if (validNumber && number >= 1) {
          project.links.forEach((l) => {
            if ((l.from === block.id || l.to === block.id) && l.width === block.width) CS.setLinkWidth(project, l, number);
          });
          block.width = number;
        }
      } else if (prop === 'protocol') {
        project.links.forEach((l) => {
          if ((l.from === block.id || l.to === block.id) && l.protocol === block.protocol) l.protocol = value;
        });
        block.protocol = value;
      } else if (prop === 'baseAddr') {
        const parsed = CS.parseHex(value);
        if (!Number.isNaN(parsed)) block.baseAddr = parsed;
        if (finished) el.value = CS.formatHex(block.baseAddr);
      } else if (prop === 'clock') {
        if (value === '__new') {
          const clock = addClock();
          block.clock = clock.id;
        } else block.clock = value || null;
      }
    } else if (scope === 'port' && selection && selection.kind === 'port') {
      const port = CS.findPort(blockById(selection.blockId), selection.id);
      if (!port) return;
      if (prop === 'name') {
        if (value.trim()) port.name = value.trim();
        else if (finished) el.value = port.name;
      } else if (prop === 'width') {
        if (validNumber && number >= 1) port.width = number;
      } else if (prop === 'dir') {
        port.dir = value;
        if (value === 'bus') port.external = false;
      } else if (prop === 'external') {
        port.external = value;
      }
    } else if (scope === 'link' && link) {
      if (prop === 'width') {
        if (validNumber && number >= 1) CS.setLinkWidth(project, link, number);
      } else if (prop === 'net') {
        if (value.trim()) CS.renameNet(project, link.net, value.trim());
        else if (finished) el.value = link.net;
      } else {
        link[prop] = value;
      }
    } else if (scope === 'clock') {
      const clock = project.clocks.find((c) => c.id === el.dataset.id);
      if (clock && prop === 'name') {
        if (value.trim()) clock.name = value.trim();
        else if (finished) el.value = clock.name;
      }
      if (clock && prop === 'mhz' && validNumber && number > 0) clock.mhz = number;
    } else if (scope === 'limit') {
      if (validNumber && (number > 0 || prop === 'pins')) project.limits[prop] = number;
    } else if (scope === 'project') {
      if (prop === 'name') {
        if (value.trim()) project.name = value;
        else if (finished) el.value = project.name;
      } else if (prop === 'target') {
        const target = CS.TARGETS[value];
        project.target = value;
        project.limits = {
          areaMm2: target.areaMm2, pins: target.pins, maxMHz: target.maxMHz,
          gateUm2: target.gateUm2, kbUm2: target.kbUm2,
        };
      }
    }
  }

  function addClock() {
    const index = project.clocks.length + 1;
    const clock = { id: `c${Date.now().toString(36)}${index}`, name: `clk_${index}`, mhz: 25 };
    project.clocks.push(clock);
    return clock;
  }

  function syncUndoButton() {
    const button = top.querySelector('[data-act="undo"]');
    if (button) button.disabled = !undoStack.length;
  }

  function softRefresh() {
    persist();
    renderTop();
    if (screen === 'sketch') {
      renderCanvas();
    } else if (screen === 'check') {
      renderCheck();
    }
    const meters = $('#meters');
    if (meters) meters.innerHTML = metersHtml();
  }

  /* ---------- Check ---------- */

  function renderCheck() {
    if (!project.blocks.length) {
      main.innerHTML = `
        <div class="page">
          <h1>Nothing to check yet</h1>
          <p class="lede">Add some blocks to your sketch, then come back here.</p>
          <div class="actions"><button class="btn primary" data-act="tab" data-arg="sketch">Go to Sketch</button></div>
        </div>`;
      return;
    }
    const issues = CS.runChecks(project);
    const count = (severity) => issues.filter((i) => i.severity === severity).length;
    const fixes = count('fix');
    const others = count('warn') + count('tip');
    const ready = CS.isReadyForRtl(issues);
    const hiddenList = CS.hiddenIssues(project);
    const hidden = hiddenList.length;
    const hiddenFixes = hiddenList.filter((i) => i.severity === 'fix').length;
    checkIndex = Math.max(0, Math.min(checkIndex, issues.length - 1));

    let heading;
    if (fixes) heading = `${fixes} ${fixes === 1 ? 'thing' : 'things'} to fix`;
    else if (ready) heading = 'Ready to start writing the design';
    else heading = 'Not quite ready yet';
    const lede = fixes
      ? (others ? `Plus ${plural(others, 'smaller suggestion')}. We’ll take them one at a time.` : 'We’ll take them one at a time.')
      : (others ? `${plural(others, 'suggestion')} left to look at.` : (hidden ? 'Nothing else to look at.' : 'No problems found in your sketch.'));

    main.innerHTML = `
      <div class="page">
        <div>
          <h1>${esc(heading)}</h1>
          <p class="lede">${esc(lede)}</p>
        </div>
        ${issues.length ? issueCard(issues[checkIndex]) : ''}
        ${issues.length > 1 ? `
          <div class="pager">
            <button class="btn quiet" data-act="check-prev"${checkIndex === 0 ? ' disabled' : ''}>Previous</button>
            <span>${checkIndex + 1} of ${issues.length}</span>
            <button class="btn quiet" data-act="check-next"${checkIndex === issues.length - 1 ? ' disabled' : ''}>Next</button>
          </div>` : ''}
        ${!fixes && ready ? `
          <div class="actions"><button class="btn primary" data-act="tab" data-arg="roadmap">See the next steps</button></div>
          <p class="muted small">This only means no known mistakes were found in the sketch. Simulation and real tools come later, and they will find more.</p>` : ''}
        <details>
          <summary>Space and pins</summary>
          <div class="stack">${metersHtml()}</div>
        </details>
        ${hidden ? `<button class="link small" style="align-self:flex-start" data-act="restore-ignored">Bring back ${plural(hidden, 'hidden item')}${hiddenFixes ? ` (${hiddenFixes} must fix)` : ''}</button>` : ''}
      </div>`;
  }

  function issueCard(issue) {
    const labels = { fix: 'Must fix', warn: 'Worth checking', tip: 'Tip' };
    const canShow = ['block', 'link', 'port', 'settings', 'features', 'sketch'].includes(issue.target.kind);
    return `
      <div class="card">
        <span class="chip ${issue.severity}">${labels[issue.severity]}</span>
        <p class="issue-title">${rich(issue.title)}</p>
        <p>${rich(issue.how)}</p>
        <details>
          <summary>Why does this matter?</summary>
          <p class="muted">${rich(issue.why)}</p>
          ${issue.tools ? `<p class="muted small" style="margin-top:8px"><strong>Tools that catch this in real projects:</strong> ${esc(issue.tools)}</p>` : ''}
        </details>
        <div class="actions">
          ${issue.fix ? `<button class="btn primary" data-act="issue-fix">${esc(issue.fix.label)}</button>` : ''}
          ${canShow ? `<button class="btn${issue.fix ? '' : ' primary'}" data-act="issue-show">Show me</button>` : ''}
          <button class="btn quiet" data-act="issue-ignore">Not a problem</button>
        </div>
      </div>`;
  }

  function currentIssue() {
    return CS.runChecks(project)[checkIndex];
  }

  function showTarget(target) {
    if (target.kind === 'features') { go('features'); return; }
    if (target.kind === 'settings') { selection = { kind: 'settings' }; renderAll(); return; }
    screen = 'sketch';
    viewMode = 'wiring';
    selection = ['block', 'link', 'port'].includes(target.kind)
      ? { kind: target.kind, id: target.id, blockId: target.blockId } : null;
    renderAll();
    fitView();
    if (target.kind === 'block') centerOn(blockById(target.id));
    if (target.kind === 'port') centerOn(blockById(target.blockId));
  }

  /* ---------- Features ---------- */

  function renderFeatures() {
    const total = project.features.length;
    const done = project.features.filter((f) => f.status === 'tested').length;
    const suggestion = CS.nextSuggestion(project);
    const statusOrder = { built: 0, todo: 1, tested: 2 };
    const shown = project.features
      .filter((f) => (featureFilter === 'open' ? f.status !== 'tested' : f.status === 'tested'))
      .sort((a, b) => (b.must - a.must) || (statusOrder[a.status] - statusOrder[b.status]));
    main.innerHTML = `
      <div class="page">
        <div class="progress-line">
          <h1>Features</h1>
          ${total ? `
            <p class="lede">${done} of ${total} built and tested</p>
            <div class="bar"><i style="width:${Math.round((done / total) * 100)}%"></i></div>` : `
            <p class="lede">List what your chip must do. This becomes your to-do list.</p>`}
        </div>
        ${suggestion ? `
          <div class="card suggest">
            <p><span class="muted small">Suggestion</span><br>${esc(suggestion.title)}</p>
            <button class="btn primary" data-act="suggest-add">Add</button>
            <button class="btn quiet" data-act="suggest-skip">Skip</button>
          </div>` : ''}
        <form class="row-add" id="feature-form">
          <input id="feature-input" maxlength="160" placeholder="What must your chip do?" aria-label="New feature" autocomplete="off">
          <button class="btn" type="submit">Add</button>
        </form>
        ${total ? `
          <div class="segment" role="group" aria-label="Show">
            <button data-act="feature-filter" data-arg="open" aria-pressed="${featureFilter === 'open'}">To do</button>
            <button data-act="feature-filter" data-arg="done" aria-pressed="${featureFilter === 'done'}">Done</button>
          </div>
          <div class="feature-list">
            ${shown.length ? shown.map(featureRow).join('') : `<p class="muted">${featureFilter === 'open' ? 'Nothing left to do. Nice work.' : 'Nothing is finished yet. Press a feature’s status to move it along.'}</p>`}
          </div>` : ''}
      </div>`;
  }

  function featureRow(f) {
    const label = { todo: 'To do', built: 'Built', tested: 'Tested' }[f.status];
    const expanded = openFeature === f.id;
    return `
      <div class="feature">
        <div class="feature-row">
          <button class="status ${f.status}" data-act="feature-status" data-arg="${esc(f.id)}" title="Press to move to the next status">${label}</button>
          <button class="feature-open" data-act="feature-open" data-arg="${esc(f.id)}" aria-expanded="${expanded}">
            <span>${esc(f.title)}</span>
            ${f.must ? '' : '<span class="tag">Nice to have</span>'}
          </button>
        </div>
        ${expanded ? `
          <div class="feature-body">
            <label class="field"><span>What should it do?</span>
              <input data-feature="title" data-id="${esc(f.id)}" value="${esc(f.title)}" maxlength="160">
            </label>
            <label class="field"><span>Which block does this?</span>
              <select data-feature="blockId" data-id="${esc(f.id)}">
                <option value="">Not assigned</option>
                ${options(project.blocks.map((b) => [b.id, b.name]), f.blockId)}
              </select>
            </label>
            <label class="field"><span>How will you prove it works?</span>
              <textarea data-feature="test" data-id="${esc(f.id)}" maxlength="300" placeholder="Example: send a byte in simulation and read it back">${esc(f.test)}</textarea>
            </label>
            <label class="check-row">
              <input type="checkbox" data-feature="must" data-id="${esc(f.id)}"${f.must ? ' checked' : ''}>
              <span>Must have for the first chip</span>
            </label>
            <div><button class="btn quiet danger-btn" data-act="feature-delete" data-arg="${esc(f.id)}">Delete feature</button></div>
          </div>` : ''}
      </div>`;
  }

  /* ---------- Roadmap ---------- */

  function renderRoadmap() {
    const doneCount = (stage) => stage.items.filter((_, i) => project.road[`${stage.id}.${i}`]).length;
    if (openStage === null) {
      const first = CS.ROADMAP.find((s) => doneCount(s) < s.items.length);
      openStage = first ? first.id : '';
    }
    main.innerHTML = `
      <div class="page">
        <div>
          <h1>Roadmap</h1>
          <p class="lede">The steps from your sketch to a real chip.</p>
        </div>
        <div class="feature-list">
          ${CS.ROADMAP.map((stage, index) => {
            const done = doneCount(stage);
            const expanded = openStage === stage.id;
            return `
              <div class="stage${done === stage.items.length ? ' complete' : ''}">
                <button class="stage-head" data-act="stage" data-arg="${stage.id}" aria-expanded="${expanded}">
                  <span class="stage-num">${done === stage.items.length ? '✓' : index + 1}</span>
                  <span>${esc(stage.title)}</span>
                  <span class="stage-count">${done} of ${stage.items.length}</span>
                </button>
                ${expanded ? `
                  <div class="stage-body">
                    <p>${rich(stage.what)}</p>
                    <div class="road-list">
                      ${stage.items.map((item, i) => {
                        const key = `${stage.id}.${i}`;
                        return `
                          <label class="check-row">
                            <input type="checkbox" data-road="${key}"${project.road[key] ? ' checked' : ''}>
                            <span>${esc(item)}</span>
                          </label>`;
                      }).join('')}
                    </div>
                    <details>
                      <summary>Which tools do this?</summary>
                      <div class="stack">
                        <div class="tool-group"><strong>Free and open source</strong><span>${esc(stage.open.join(', '))}</span></div>
                        <div class="tool-group"><strong>Commercial</strong><span>${esc(stage.paid.join(', '))}</span></div>
                        ${stage.docs.length ? `
                          <div class="tool-group"><strong>Read more</strong>
                            <span>${stage.docs.map(([label, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`).join(' · ')}</span>
                          </div>` : ''}
                      </div>
                    </details>
                  </div>` : ''}
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  /* ---------- Actions ---------- */

  function go(next) {
    screen = next;
    pickerOpen = false;
    if (selection && selection.kind !== 'settings' && selection.kind !== 'glossary') selection = null;
    renderAll();
    if (next === 'sketch') fitView();
  }

  function openProjectFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let opened;
      try {
        opened = CS.openProject(JSON.parse(reader.result));
      } catch (err) {
        toast('That file could not be opened. It may not be a ChipSketch project.');
        return;
      }
      // Nothing is kept until the file has drawn successfully, so that a file
      // reported as unopenable cannot replace the current chip or its autosave.
      const before = { project, wizard, undoStack, selection, screen, openStage, checkIndex, view };
      try {
        project = opened.project;
        wizard = null;
        undoStack = [];
        selection = null;
        screen = 'sketch';
        openStage = null;
        checkIndex = 0;
        renderAll();
        fitView();
        persist();
        toast(opened.hiddenByFile
          ? `Opened ${project.name}. Anything this file had hidden is showing again.`
          : `Opened ${project.name}`);
      } catch (err) {
        ({ project, wizard, undoStack, selection, screen, openStage, checkIndex, view } = before);
        renderAll();
        toast('That file could not be opened. Your current chip has not changed.');
      }
    };
    reader.onerror = () => toast('That file could not be read.');
    reader.readAsText(file);
  }

  const ACTIONS = {
    tab: (arg) => go(arg),
    settings: () => select({ kind: 'settings' }),
    glossary: () => { menuOpen = false; selection = { kind: 'glossary' }; renderAll(); },
    undo,
    menu: () => { menuOpen = !menuOpen; confirmNew = false; renderTop(); },
    save: () => {
      menuOpen = false;
      download(`${fileStem()}.chipsketch.json`, JSON.stringify(project, null, 2), 'application/json');
      renderTop();
      toast('Project file saved');
    },
    open: () => { menuOpen = false; if (project) renderTop(); $('#file').click(); },
    'export-md': () => {
      menuOpen = false;
      download(`${fileStem()}_spec.md`, CS.toMarkdown(project, CS.runChecks(project), CS.hiddenIssues(project)), 'text/markdown');
      renderTop();
      toast('Written spec saved');
    },
    'export-sdc': () => {
      menuOpen = false;
      download(`${fileStem()}.sdc`, CS.toSdc(project), 'text/plain');
      renderTop();
      toast('Saved. Its clock names match the Verilog export.');
    },
    'export-verilog': () => {
      menuOpen = false;
      const issues = CS.allIssues(project);
      download(`${fileStem()}_top.v`, CS.toVerilog(project, issues), 'text/plain');
      renderTop();
      const fixes = issues.filter((i) => i.severity === 'fix').length;
      toast(fixes ? `Saved, with a note about ${plural(fixes, 'must-fix problem')}.` : 'Saved. Each block is empty, ready for your logic.');
    },
    new: () => {
      if (!confirmNew) { confirmNew = true; renderTop(); return; }
      menuOpen = false;
      confirmNew = false;
      startWizard();
    },
    picker: () => { pickerOpen = !pickerOpen; renderSketch(); },
    'picker-group': (arg) => { pickerGroup = arg; renderSketch(); },
    'add-block': (arg) => {
      pickerOpen = false;
      if (viewMode === 'map') viewMode = 'wiring';
      const spot = freeSpot();
      const block = mutate(() => CS.createBlock(project, arg, spot.x, spot.y));
      select({ kind: 'block', id: block.id });
    },
    fit: () => fitView(),
    tidy: () => {
      mutate(() => CS.layout.tidy(project));
      fitView();
    },
    lens: (arg) => { viewMode = arg; renderSketch(); },
    'select-block': (arg) => select({ kind: 'block', id: arg }),
    'select-port': (arg) => select({ kind: 'port', blockId: selection.id, id: arg }),
    'select-link': (arg) => select({ kind: 'link', id: arg }),
    'auto-addresses': () => mutate(() => CS.assignAddresses(project)),
    'add-port': () => {
      const block = blockById(selection.id);
      const port = mutate(() => CS.addPort(project, block, 'new_port', 'in', 1));
      select({ kind: 'port', blockId: block.id, id: port.id });
    },
    'delete-port': () => {
      const { blockId, id } = selection;
      selection = { kind: 'block', id: blockId };
      mutate(() => CS.removePort(project, blockById(blockId), id));
    },
    'close-drawer': () => select(null),
    'delete-block': () => {
      const { id } = selection;
      selection = null;
      mutate(() => CS.removeBlock(project, id));
    },
    'delete-link': () => {
      const { id } = selection;
      selection = null;
      mutate(() => CS.removeLink(project, id));
    },
    'add-clock': () => mutate(() => addClock()),
    'delete-clock': (arg) => mutate(() => {
      const remaining = project.clocks.filter((c) => c.id !== arg);
      project.clocks = remaining;
      project.blocks.forEach((b) => { if (b.clock === arg) b.clock = remaining[0].id; });
    }),
    'check-prev': () => { checkIndex -= 1; renderCheck(); },
    'check-next': () => { checkIndex += 1; renderCheck(); },
    'issue-fix': () => {
      const issue = currentIssue();
      mutate(() => CS.applyFix(project, issue.fix));
      toast('Done. Press Undo if you change your mind.');
    },
    'issue-show': () => showTarget(currentIssue().target),
    'issue-ignore': () => {
      const issue = currentIssue();
      mutate(() => { project.ignored.push(issue.key); });
    },
    'restore-ignored': () => mutate(() => { project.ignored = []; }),
    'suggest-add': () => {
      const s = CS.nextSuggestion(project);
      mutate(() => CS.createFeature(project, s.title, s.blockId, { sourceKey: s.key }));
    },
    'suggest-skip': () => {
      const s = CS.nextSuggestion(project);
      mutate(() => { project.skippedSuggestions.push(s.key); });
    },
    'feature-filter': (arg) => { featureFilter = arg; renderFeatures(); },
    'feature-status': (arg) => {
      const f = project.features.find((x) => x.id === arg);
      const order = ['todo', 'built', 'tested'];
      mutate(() => { f.status = order[(order.indexOf(f.status) + 1) % order.length]; });
    },
    'feature-open': (arg) => { openFeature = openFeature === arg ? null : arg; renderFeatures(); },
    'feature-delete': (arg) => {
      openFeature = null;
      mutate(() => { project.features = project.features.filter((f) => f.id !== arg); });
    },
    stage: (arg) => { openStage = openStage === arg ? '' : arg; renderRoadmap(); },
    'wiz-next': () => {
      if (wizard.step === 0) {
        const input = $('#wiz-name');
        if (input) wizard.name = input.value;
      }
      if (wizard.step === 2) { finishWizard(); return; }
      wizard.step += 1;
      renderWizard();
    },
    'wiz-back': () => { wizard.step -= 1; renderWizard(); },
    'wiz-cancel': () => { wizard = null; renderAll(); fitView(); },
    'wiz-template': (arg) => { wizard.template = arg; wizard.target = null; renderWizard(); },
    'wiz-target': (arg) => { wizard.target = arg; renderWizard(); },
  };

  function showTerm(button) {
    const pop = $('#popover');
    const key = button.dataset.arg;
    pop.textContent = CS.GLOSSARY[key];
    pop.hidden = false;
    const box = button.getBoundingClientRect();
    const popBox = pop.getBoundingClientRect();
    const left = Math.max(8, Math.min(box.left, window.innerWidth - popBox.width - 8));
    const below = box.bottom + 8;
    const topPos = below + popBox.height > window.innerHeight ? box.top - popBox.height - 8 : below;
    pop.style.left = `${left}px`;
    pop.style.top = `${topPos}px`;
  }

  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-act]');
    const pop = $('#popover');
    if (trigger && trigger.dataset.act === 'term') {
      e.preventDefault();
      showTerm(trigger);
      return;
    }
    pop.hidden = true;
    const outsideMenu = !e.target.closest('.menu') && !(trigger && trigger.dataset.act === 'menu');
    if (menuOpen && outsideMenu) {
      menuOpen = false;
      confirmNew = false;
      renderTop();
    }
    if (trigger && !trigger.disabled) {
      const handler = ACTIONS[trigger.dataset.act];
      if (handler) handler(trigger.dataset.arg);
    }
  });

  document.addEventListener('focusin', (e) => {
    if (e.target.dataset && (e.target.dataset.field || e.target.dataset.feature)) {
      pendingSnapshot = JSON.stringify(project);
    }
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.field && el.tagName !== 'SELECT' && el.type !== 'checkbox') {
      applyField(el, false);
      softRefresh();
    } else if (el.dataset.feature && el.tagName !== 'SELECT' && el.type !== 'checkbox') {
      const f = project.features.find((x) => x.id === el.dataset.id);
      if (f && (el.dataset.feature === 'test' || el.value.trim())) f[el.dataset.feature] = el.value;
      persist();
      renderTop();
    } else if (el.id === 'wiz-name') {
      wizard.name = el.value;
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.id === 'file') {
      if (el.files[0]) openProjectFile(el.files[0]);
      el.value = '';
      return;
    }
    if (el.dataset.road) {
      pushUndo();
      if (el.checked) project.road[el.dataset.road] = true;
      else delete project.road[el.dataset.road];
      persist();
      renderTop();
      renderRoadmap();
      return;
    }
    if (el.dataset.feature) {
      const f = project.features.find((x) => x.id === el.dataset.id);
      if (!f) return;
      if (pendingSnapshot) pushUndo(pendingSnapshot);
      pendingSnapshot = JSON.stringify(project);
      if (el.dataset.feature === 'must') f.must = el.checked;
      else if (el.dataset.feature === 'blockId') f.blockId = el.value || null;
      else if (el.dataset.feature === 'title') {
        if (el.value.trim()) f.title = el.value.trim();
        else el.value = f.title;
      } else f.test = el.value;
      persist();
      syncUndoButton();
      return;
    }
    if (!el.dataset.field) return;
    if (el.dataset.field === 'block.connect') {
      if (el.value) connect(selection.id, el.value);
      return;
    }
    if (el.dataset.field === 'port.connect') {
      if (el.value) connect(selection.blockId, el.value, { fromPort: selection.id });
      return;
    }
    if (pendingSnapshot) pushUndo(pendingSnapshot);
    pendingSnapshot = JSON.stringify(project);
    applyField(el, true);
    persist();
    if (el.tagName === 'SELECT' || el.type === 'checkbox') renderAll();
    else syncUndoButton();
  });

  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'feature-form') return;
    e.preventDefault();
    const input = $('#feature-input');
    const title = input.value.trim();
    if (!title) return;
    featureFilter = 'open';
    mutate(() => CS.createFeature(project, title));
    const next = $('#feature-input');
    if (next) next.focus();
  });

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (e.key === 'Enter' && wizard && e.target.id === 'wiz-name') {
      ACTIONS['wiz-next']();
      return;
    }
    if (e.key === 'Escape') {
      $('#popover').hidden = true;
      if (menuOpen) { menuOpen = false; renderTop(); } else if (selection) select(null);
      return;
    }
    if (wizard || typing) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selection && screen === 'sketch') {
      if (selection.kind === 'block') { e.preventDefault(); ACTIONS['delete-block'](); }
      else if (selection.kind === 'link') { e.preventDefault(); ACTIONS['delete-link'](); }
      else if (selection.kind === 'port') { e.preventDefault(); ACTIONS['delete-port'](); }
    }
  });

  window.addEventListener('resize', () => { if (screen === 'sketch' && !wizard) applyView(); });

  /* ---------- Start ---------- */

  function start() {
    let saved = null;
    try {
      saved = localStorage.getItem(STORE_KEY);
    } catch (err) {
      saved = null;
    }
    if (saved) {
      try {
        project = CS.normalize(JSON.parse(saved));
        renderAll();
        fitView();
        persist(); // Stores an older project in the current format, once it has drawn.
        toast(`Restored ${project.name} from your last session`);
        return;
      } catch (err) {
        project = null;
      }
    }
    startWizard();
  }

  start();
}(window.CS));
