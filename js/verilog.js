// Writes the diagram out as Verilog: a top module that wires the blocks together,
// plus an empty module for each block. Pure text generation, with no page access.
window.CS = window.CS || {};

(function (CS) {
  'use strict';

  const oneLine = (text) => String(text).replace(/[\r\n]+/g, ' ');
  const legal = (name) => (CS.isLegalName(name) ? name : CS.identifier(name));
  const range = (width) => (width > 1 ? `[${width - 1}:0] ` : '');
  const DIRECTIONS = { in: 'input ', out: 'output', inout: 'inout ', bus: 'inout ' };

  // Gives a name that is legal and not already taken, and records it as taken.
  function claimer(initial) {
    const taken = [...(initial || [])];
    return (name) => {
      const unique = CS.uniqueName(legal(name), taken);
      taken.push(unique);
      return unique;
    };
  }

  // Every name is settled before any text is written, so that the top module and
  // the block modules cannot disagree.
  function resolveNames(p) {
    const claimModule = claimer();
    const topModule = claimModule(CS.identifier(p.name, 'chip_top'));
    const clocks = CS.clockPortNames(p);
    const claim = claimer([...clocks.values()]);

    const pins = new Map();
    const blocks = new Map();
    p.blocks.forEach((block) => {
      const claimPort = claimer();
      const ports = new Map(block.ports.map((x) => [x.id, claimPort(x.name)]));
      block.ports.forEach((x) => {
        const linked = CS.linksOnPort(p, x.id).length > 0;
        if (x.external && !linked) pins.set(x.id, claim(CS.pinName(block, x)));
      });
      blocks.set(block.id, {
        module: claimModule(CS.identifier(block.name, 'block')),
        instance: '',
        ports,
        clk: claimPort('clk'),
        rstN: claimPort('rst_n'),
      });
    });
    p.blocks.forEach((block) => { blocks.get(block.id).instance = claim(`u_${CS.identifier(block.name, 'block')}`); });

    const nets = new Map();
    p.links.forEach((link) => {
      if (!nets.has(link.net)) nets.set(link.net, { name: claim(link.net), link });
    });

    // A reset controller drives every block's reset. Without one, reset is a chip input.
    const resetBlock = p.blocks.find((b) => b.type === 'reset' && b.ports.some((x) => x.dir === 'out'));
    const reset = { block: resetBlock || null, port: null, signal: '', isInput: !resetBlock };
    if (resetBlock) {
      reset.port = resetBlock.ports.find((x) => x.dir === 'out');
      const link = CS.linksOnPort(p, reset.port.id)[0];
      reset.declare = !link;
      reset.signal = link ? nets.get(link.net).name : claim('rst_n');
    } else {
      reset.signal = claim('rst_n');
    }
    return { topModule, clocks, pins, blocks, nets, reset };
  }

  function portList(lines) {
    if (!lines.length) return '();';
    const body = lines.map(({ text, note }, i) => {
      const comma = i < lines.length - 1 ? ',' : '';
      return `    ${text}${comma}${note ? ` // ${note}` : ''}`;
    });
    return `(\n${body.join('\n')}\n);`;
  }

  function topPorts(p, names) {
    const lines = p.clocks.map((c) => ({ text: `input  wire ${names.clocks.get(c.id)}`, note: `${c.mhz} MHz` }));
    if (names.reset.isInput) lines.push({ text: `input  wire ${names.reset.signal}`, note: 'active low' });
    p.blocks.forEach((block) => {
      block.ports.forEach((x) => {
        if (names.pins.has(x.id)) {
          lines.push({ text: `${DIRECTIONS[x.dir]} wire ${range(x.width)}${names.pins.get(x.id)}` });
        }
      });
    });
    return lines;
  }

  function netNote(p, link) {
    const a = p.blocks.find((b) => b.id === link.from);
    const b = p.blocks.find((x) => x.id === link.to);
    const notes = [];
    if (link.protocol !== 'wires') notes.push(`${CS.PROTOCOL_TAGS[link.protocol]} placeholder`);
    if (a && b && a.clock && b.clock && a.clock !== b.clock) {
      notes.push(link.crossing === 'none' ? 'clock crossing not handled' : `clock crossing: ${CS.CROSSINGS[link.crossing]}`);
    }
    return notes.join('; ');
  }

  function topSignal(p, names, block, port) {
    const link = CS.linksOnPort(p, port.id)[0];
    if (link) return names.nets.get(link.net).name;
    if (names.pins.has(port.id)) return names.pins.get(port.id);
    if (names.reset.port && names.reset.port.id === port.id) return names.reset.signal;
    return '';
  }

  function instanceText(p, names, block) {
    const info = names.blocks.get(block.id);
    const lines = [];
    if (block.clock && names.clocks.has(block.clock)) lines.push(`.${info.clk}(${names.clocks.get(block.clock)})`);
    if (!names.reset.block || names.reset.block.id !== block.id) lines.push(`.${info.rstN}(${names.reset.signal})`);
    block.ports.forEach((x) => lines.push(`.${info.ports.get(x.id)}(${topSignal(p, names, block, x)})`));
    const heading = `    // ${oneLine(block.name)}`;
    if (!lines.length) return `${heading}\n    ${info.module} ${info.instance} ();`;
    const body = lines.map((line, i) => `        ${line}${i < lines.length - 1 ? ',' : ''}`).join('\n');
    return `${heading}\n    ${info.module} ${info.instance} (\n${body}\n    );`;
  }

  function moduleText(p, names, block) {
    const info = names.blocks.get(block.id);
    const lines = [];
    if (block.clock && names.clocks.has(block.clock)) lines.push({ text: `input  wire ${info.clk}` });
    if (!names.reset.block || names.reset.block.id !== block.id) lines.push({ text: `input  wire ${info.rstN}`, note: 'active low' });
    block.ports.forEach((x) => {
      lines.push({
        text: `${DIRECTIONS[x.dir]} wire ${range(x.width)}${info.ports.get(x.id)}`,
        note: x.dir === 'bus' ? 'bus interface placeholder' : '',
      });
    });
    // Outputs are held at zero, so that the empty block simulates without unknown values.
    const ties = block.ports.filter((x) => x.dir === 'out').map((x) => (
      `    assign ${info.ports.get(x.id)} = ${x.width > 1 ? `{${x.width}{1'b0}}` : "1'b0"};`
    ));
    const kind = CS.typeOf(block).label;
    const title = block.name === kind ? oneLine(block.name) : `${oneLine(block.name)} (${kind})`;
    return [
      `// ${title}. Write this block's logic here.`,
      `module ${info.module} ${portList(lines)}`,
      ...ties,
      'endmodule',
    ].join('\n');
  }

  function toVerilog(p, issues) {
    const names = resolveNames(p);
    const fixList = (issues || []).filter((i) => i.severity === 'fix');
    const fixes = fixList.length;
    const hiddenFixes = fixList.filter((i) => p.ignored.includes(i.key)).length;
    const hiddenNote = hiddenFixes ? ` ${hiddenFixes} of them marked as "Not a problem".` : '';
    const hasBus = p.links.some((l) => l.protocol !== 'wires');
    const hasPll = p.blocks.some((b) => b.type === 'pll');
    const header = [
      `// Top-level Verilog for ${oneLine(p.name)}, written by ChipSketch.`,
      '// This is a starting point: it shows the structure, and each block is empty.',
      ...(hasBus ? ['// Each bus interface is one placeholder vector. Replace it with the real signals of its protocol.'] : []),
      '// Clock ports use the same names as the ChipSketch .sdc export.',
      ...(hasPll ? ['// Every clock is a chip input here. If your clock generator makes one, drive it from clk_out instead.'] : []),
      ...(fixes ? [`// WARNING: the sketch still had ${fixes} must-fix problem${fixes === 1 ? '' : 's'} when this was written.${hiddenNote}`] : []),
    ];

    const wires = [...names.nets.values()].map(({ name, link }) => {
      const note = netNote(p, link);
      return `    wire ${range(link.width)}${name};${note ? ` // ${note}` : ''}`;
    });
    if (names.reset.declare) wires.push(`    wire ${names.reset.signal}; // reset from ${oneLine(names.reset.block.name)}`);

    const top = [
      `module ${names.topModule} ${portList(topPorts(p, names))}`,
      ...(wires.length ? ['', ...wires] : []),
      ...p.blocks.flatMap((block) => ['', instanceText(p, names, block)]),
      'endmodule',
    ].join('\n');

    return [
      header.join('\n'),
      '',
      '`default_nettype none',
      '',
      top,
      ...p.blocks.flatMap((block) => ['', moduleText(p, names, block)]),
      '',
      '`default_nettype wire',
      '',
    ].join('\n');
  }

  CS.toVerilog = toVerilog;
}(window.CS));
