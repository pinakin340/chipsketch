// The architecture rules. Pure functions: a project goes in, a list of issues comes out.
//
// Each issue has:
//   key       stable id, so that a user can mark it as "not a problem"
//   severity  'fix' (must fix), 'warn' (worth checking) or 'tip'
//   title     one plain sentence. [[term|label]] becomes a glossary link
//   why       why it matters
//   how       what to do about it
//   tools     what catches this in a real flow
//   target    what "Show me" opens: {kind:'block'|'link'|'settings'|'features', id}
//   fix       optional {label, action, ...} for "Fix it for me"
window.CS = window.CS || {};

(function (CS) {
  'use strict';

  const CDC_TOOLS = 'VC SpyGlass CDC, Questa CDC';
  const LINT_TOOLS = 'Verilator (UNDRIVEN, UNUSEDSIGNAL warnings) and Yosys check';
  const ADDRESS_TOOLS = 'SystemRDL with PeakRDL, or IP-XACT with Kactus2';
  const PERF_TOOLS = 'Synopsys Platform Architect, gem5';
  const PLAN_TOOLS = 'A verification plan, tested with cocotb or UVM';
  const DRIVER_TOOLS = 'Yosys check, Verilator (MULTIDRIVEN, UNDRIVEN warnings)';

  const plain = (text) => text.replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, '$1');

  function assignAddresses(p) {
    const roundUp = (n) => { let v = 1; while (v < n) v *= 2; return v; };
    const onBus = addressable(p);
    let cursor = 0;
    onBus.filter((b) => b.type === 'memory').forEach((b) => {
      const size = roundUp(CS.sizeBytes(b));
      cursor = Math.ceil(cursor / size) * size;
      b.baseAddr = cursor;
      cursor += size;
    });
    cursor = Math.max(cursor, 0x10000000);
    onBus.filter((b) => b.type !== 'memory').forEach((b) => {
      const size = roundUp(CS.sizeBytes(b));
      cursor = Math.ceil(cursor / size) * size;
      b.baseAddr = cursor;
      cursor += size;
    });
  }

  function addressable(p) {
    return p.blocks.filter((b) => CS.typeOf(b).addr && p.links.some((l) => {
      if (l.from !== b.id && l.to !== b.id) return false;
      const other = p.blocks.find((x) => x.id === (l.from === b.id ? l.to : l.from));
      return other && CS.roleOf(other) === 'bus';
    }));
  }

  function neighbours(p, blockId) {
    return p.links
      .filter((l) => l.from === blockId || l.to === blockId)
      .map((l) => p.blocks.find((b) => b.id === (l.from === blockId ? l.to : l.from)))
      .filter(Boolean);
  }

  function reachableFromManagers(p) {
    const seen = new Set();
    const stack = p.blocks
      .filter((b) => ['manager', 'both'].includes(CS.roleOf(b)))
      .map((b) => b.id);
    while (stack.length) {
      const id = stack.pop();
      if (!seen.has(id)) {
        seen.add(id);
        neighbours(p, id).forEach((n) => stack.push(n.id));
      }
    }
    return seen;
  }

  // Follows only "direct wire" links, in their own direction, and returns just the links
  // that form the loop. It uses its own stack, so a very long chain cannot overflow the
  // browser's, and a Map, so that a block id such as "constructor" is an ordinary key.
  function findCombLoop(p) {
    const outgoing = new Map();
    p.links.filter((l) => l.comb).forEach((l) => {
      if (!outgoing.has(l.from)) outgoing.set(l.from, []);
      outgoing.get(l.from).push(l);
    });
    const state = new Map();
    for (const block of p.blocks) {
      if (!state.has(block.id)) {
        state.set(block.id, 'open');
        const stack = [{ id: block.id, next: 0, via: null }];
        while (stack.length) {
          const top = stack[stack.length - 1];
          const links = outgoing.get(top.id) || [];
          if (top.next >= links.length) {
            state.set(top.id, 'done');
            stack.pop();
          } else {
            const link = links[top.next];
            top.next += 1;
            if (state.get(link.to) === 'open') {
              const start = stack.findIndex((frame) => frame.id === link.to);
              return stack.slice(start + 1).map((frame) => frame.via).concat(link);
            }
            if (!state.has(link.to)) {
              state.set(link.to, 'open');
              stack.push({ id: link.to, next: 0, via: link });
            }
          }
        }
      }
    }
    return null;
  }

  function checkStructure(p, add) {
    if (!p.blocks.length) {
      add('empty', '', 'tip', {
        title: 'Your chip has no blocks yet.',
        why: 'Checks need something to look at.',
        how: 'Go to Sketch and add your first block.',
        target: { kind: 'sketch' },
      });
      return;
    }
    const reachable = reachableFromManagers(p);
    p.blocks.forEach((b) => {
      const role = CS.roleOf(b);
      const links = neighbours(p, b.id);
      if (!links.length && role !== 'support') {
        add('orphan', b.id, 'fix', {
          title: `${b.name} is not connected to anything.`,
          why: 'An unconnected block cannot do any work, but it still takes up space on the chip.',
          how: 'Connect it to another block, or delete it.',
          tools: LINT_TOOLS,
          target: { kind: 'block', id: b.id },
        });
        return;
      }
      if (role === 'bus') {
        if (!reachable.has(b.id)) {
          add('bus-no-manager', b.id, 'fix', {
            title: `Nothing on ${b.name} can start a request.`,
            why: 'A [[bus|bus]] needs at least one [[manager|manager]], such as a processor, or no data ever moves.',
            how: 'Connect a processor or accelerator to this bus.',
            target: { kind: 'block', id: b.id },
          });
        }
        if (!links.some((n) => ['subordinate', 'both', 'bus'].includes(CS.roleOf(n)))) {
          add('bus-no-sub', b.id, 'warn', {
            title: `${b.name} has nothing to talk to.`,
            why: 'A bus with no [[subordinate|subordinates]] carries no useful traffic.',
            how: 'Connect a memory or peripheral to this bus.',
            target: { kind: 'block', id: b.id },
          });
        }
      } else if (role === 'subordinate' && links.length && !reachable.has(b.id)) {
        add('sub-unreachable', b.id, 'warn', {
          title: `Nothing can give orders to ${b.name}.`,
          why: 'A [[subordinate|subordinate]] only answers requests, and no [[manager|manager]] can reach this one.',
          how: 'Connect it to a bus that has a processor, or to a block that controls it.',
          target: { kind: 'block', id: b.id },
        });
      }
    });

    p.links.forEach((l) => {
      const a = p.blocks.find((b) => b.id === l.from);
      const z = p.blocks.find((b) => b.id === l.to);
      const roles = [CS.roleOf(a), CS.roleOf(z)];
      const hasDebug = a.type === 'debug' || z.type === 'debug';
      if (roles[0] === 'manager' && roles[1] === 'manager' && !hasDebug) {
        add('manager-pair', l.id, 'warn', {
          title: `${a.name} and ${z.name} both give orders, but are wired directly together.`,
          why: 'Two [[manager|managers]] on one link have no [[subordinate|subordinate]] to answer them.',
          how: 'Connect each one to a shared bus instead.',
          target: { kind: 'link', id: l.id },
        });
      }
      if (roles[0] === 'subordinate' && roles[1] === 'subordinate') {
        add('sub-pair', l.id, 'warn', {
          title: `${a.name} and ${z.name} both wait for orders, but are wired directly together.`,
          why: 'Neither block will start a request, so this link may never carry any data.',
          how: 'Connect each one to a bus, or add a block to control them.',
          target: { kind: 'link', id: l.id },
        });
      }
    });

    const loop = findCombLoop(p);
    if (loop) {
      const names = loop.slice(0, 6).map((l) => p.blocks.find((b) => b.id === l.from).name);
      const more = loop.length > names.length ? ` and ${loop.length - names.length} more` : '';
      add('comb-loop', loop[0].id, 'fix', {
        title: `Signals loop through ${names.join(', ')}${more} with no flip-flop.`,
        why: 'A [[combloop|combinational loop]] can oscillate forever, and timing tools cannot analyse it.',
        how: 'Add a flip-flop to at least one link in the loop.',
        tools: 'Yosys check and scc, Verilator (UNOPTFLAT warning)',
        target: { kind: 'link', id: loop[0].id },
        fix: { label: 'Add a flip-flop', action: 'set-comb', linkId: loop[0].id },
      });
    }
  }

  function checkClocks(p, add) {
    const clockOf = (b) => p.clocks.find((c) => c.id === b.clock);
    p.blocks.forEach((b) => {
      if (!clockOf(b) && CS.roleOf(b) !== 'support') {
        add('no-clock', b.id, 'fix', {
          title: `${b.name} has no clock.`,
          why: 'Without a clock, a block never moves on to its next step.',
          how: 'Choose a clock for this block.',
          target: { kind: 'block', id: b.id },
        });
      }
    });

    p.links.forEach((l) => {
      const a = p.blocks.find((b) => b.id === l.from);
      const z = p.blocks.find((b) => b.id === l.to);
      const crossing = a.clock && z.clock && a.clock !== z.clock;
      if (crossing && l.crossing === 'none') {
        const best = l.width === 1 ? '2ff' : 'fifo';
        add('cdc-unhandled', l.id, 'fix', {
          title: `${a.name} and ${z.name} use different clocks, with nothing to make the [[cdc|crossing]] safe.`,
          why: 'Data can arrive while a flip-flop is sampling it. That causes [[metastability|metastability]], which shows up as rare random failures that are very hard to debug.',
          how: l.width === 1
            ? 'One wire can cross through a two flip-flop [[synchronizer|synchronizer]].'
            : `${l.width} wires should cross through an async [[fifo|FIFO]] or a handshake.`,
          tools: CDC_TOOLS,
          target: { kind: 'link', id: l.id },
          fix: { label: `Use ${best === '2ff' ? 'two flip-flops' : 'an async FIFO'}`, action: 'set-crossing', linkId: l.id, crossing: best },
        });
      }
      if (crossing && l.crossing === '2ff' && l.width > 1) {
        add('cdc-multibit', l.id, 'fix', {
          title: `${a.name} sends ${l.width} wires to ${z.name} through a circuit made for one wire.`,
          why: 'Each wire can settle on a different clock tick, so the receiver can see a value that was never sent.',
          how: 'Use an async [[fifo|FIFO]] or a handshake. Two flip-flops are safe for several wires only if at most one changes at a time, as in a Gray-code counter.',
          tools: CDC_TOOLS,
          target: { kind: 'link', id: l.id },
          fix: { label: 'Use an async FIFO', action: 'set-crossing', linkId: l.id, crossing: 'fifo' },
        });
      }
      if (!crossing && l.crossing !== 'none') {
        add('cdc-unneeded', l.id, 'tip', {
          title: `The link from ${a.name} to ${z.name} has crossing logic it does not need.`,
          why: 'Both blocks share a clock, so this only adds delay and area.',
          how: 'Remove the crossing.',
          target: { kind: 'link', id: l.id },
          fix: { label: 'Remove the crossing', action: 'set-crossing', linkId: l.id, crossing: 'none' },
        });
      }
    });

    p.clocks.forEach((c) => {
      if (c.mhz > p.limits.maxMHz) {
        add('over-freq', c.id, 'warn', {
          title: `${c.name} runs at ${c.mhz} MHz, above the rough limit of ${p.limits.maxMHz} MHz for this target.`,
          why: 'Signals may not get through the logic in one clock tick. Timing would fail late in the project, when changes are costly.',
          how: 'Slow this clock, or plan to split long logic paths into stages.',
          tools: 'OpenSTA (report_wns), PrimeTime, Tempus',
          target: { kind: 'settings' },
        });
      }
    });

    if (p.blocks.length) {
      p.clocks.forEach((c) => {
        if (!p.blocks.some((b) => b.clock === c.id)) {
          add('unused-clock', c.id, 'tip', {
            title: `No block uses ${c.name}.`,
            why: 'An unused clock adds nothing and may confuse people reading the design.',
            how: 'Assign it to a block, or delete it in chip settings.',
            target: { kind: 'settings' },
          });
        }
      });
    }

    const used = new Set(p.blocks.map((b) => b.clock).filter(Boolean));
    if (used.size > 1) {
      if (!p.blocks.some((b) => b.type === 'reset')) {
        add('reset-domains', '', 'warn', {
          title: `Your chip has ${used.size} [[clockdomain|clock domains]] but no reset controller.`,
          why: 'Releasing reset in the wrong moment can upset flip-flops, just like a data crossing. Each domain needs a reset released in step with its own clock.',
          how: 'Add a reset controller.',
          tools: 'VC SpyGlass RDC, Questa RDC, Verilator (SYNCASYNCNET warning)',
          target: { kind: 'sketch' },
          fix: { label: 'Add a reset controller', action: 'add-block', blockType: 'reset' },
        });
      }
      if (!p.blocks.some((b) => b.type === 'pll')) {
        add('clock-source', '', 'tip', {
          title: `Where do your ${used.size} clocks come from?`,
          why: 'Each clock needs either its own input pin or a clock generator.',
          how: 'Add a clock generator, or plan an input pin for each clock.',
          target: { kind: 'sketch' },
          fix: { label: 'Add a clock generator', action: 'add-block', blockType: 'pll' },
        });
      }
    }
  }

  function checkAddresses(p, add) {
    const blocks = addressable(p);
    const missing = blocks.filter((b) => b.baseAddr === null);
    const autoFix = { label: 'Assign addresses for me', action: 'auto-addresses' };
    missing.forEach((b) => {
      add('no-address', b.id, 'fix', {
        title: `${b.name} is on a bus but has no [[address|address]].`,
        why: 'The processor picks which block to talk to by address. Without one, it cannot reach this block.',
        how: 'Give it an address, or let the tool pick them all.',
        tools: ADDRESS_TOOLS,
        target: { kind: 'block', id: b.id },
        fix: autoFix,
      });
    });
    const placed = blocks.filter((b) => b.baseAddr !== null);
    placed.forEach((a, i) => {
      placed.slice(i + 1).forEach((b) => {
        const aEnd = a.baseAddr + CS.sizeBytes(a);
        const bEnd = b.baseAddr + CS.sizeBytes(b);
        if (a.baseAddr < bEnd && b.baseAddr < aEnd) {
          add('addr-overlap', `${a.id}+${b.id}`, 'fix', {
            title: `${a.name} and ${b.name} use the same [[address|addresses]].`,
            why: 'A request to a shared address could reach either block, or both, and return the wrong data.',
            how: 'Move one of them, or let the tool assign new addresses.',
            tools: ADDRESS_TOOLS,
            target: { kind: 'block', id: b.id },
            fix: autoFix,
          });
        }
      });
      const size = CS.sizeBytes(a);
      let rounded = 1;
      while (rounded < size) rounded *= 2;
      if (a.baseAddr % rounded !== 0) {
        add('addr-align', a.id, 'warn', {
          title: `${a.name} starts at an address that is not a multiple of its size.`,
          why: 'Aligned addresses let hardware choose a block by looking at just a few address bits, which keeps the logic small.',
          how: 'Move it to a multiple of its size, or let the tool assign new addresses.',
          tools: ADDRESS_TOOLS,
          target: { kind: 'block', id: a.id },
          fix: autoFix,
        });
      }
    });
  }

  function checkBuses(p, add) {
    p.blocks.filter((b) => CS.roleOf(b) === 'bus').forEach((bus) => {
      p.links.filter((l) => l.from === bus.id || l.to === bus.id).forEach((l) => {
        const other = p.blocks.find((b) => b.id === (l.from === bus.id ? l.to : l.from));
        if (l.width !== bus.width) {
          add('width-mismatch', l.id, 'warn', {
            title: `${other.name} connects with ${l.width} bits, but ${bus.name} is ${bus.width} bits wide.`,
            why: 'Mismatched widths cut off data or pad it with zeros, unless a width converter is added.',
            how: 'Match the widths, or plan a width converter.',
            tools: 'Verilator (WIDTHTRUNC, WIDTHEXPAND warnings)',
            target: { kind: 'link', id: l.id },
            fix: { label: `Use ${bus.width} bits`, action: 'set-width', linkId: l.id, width: bus.width },
          });
        }
        if (l.protocol !== bus.protocol) {
          add('protocol-mismatch', l.id, 'warn', {
            title: `${other.name} speaks ${CS.PROTOCOLS[l.protocol]}, but ${bus.name} speaks ${CS.PROTOCOLS[bus.protocol]}.`,
            why: 'Different protocols follow different signalling rules, so they cannot connect directly.',
            how: 'Match the protocols, or plan a bridge between them.',
            target: { kind: 'link', id: l.id },
            fix: { label: 'Match the bus protocol', action: 'set-protocol', linkId: l.id, protocol: bus.protocol },
          });
        }
      });

      const clock = p.clocks.find((c) => c.id === bus.clock);
      if (!clock) return;
      const capacity = (bus.width / 8) * clock.mhz;
      const peers = new Map(neighbours(p, bus.id).map((n) => [n.id, n]));
      const demand = [...peers.values()].reduce((sum, n) => sum + n.mbps, 0);
      if (demand > capacity) {
        add('bus-overload', bus.id, 'warn', {
          title: `${bus.name} needs to carry ${demand} MB/s, but can carry about ${Math.round(capacity)} MB/s.`,
          why: 'Blocks would spend time waiting for the bus, and the chip could miss its performance goals.',
          how: 'Widen the bus, speed up its clock, or lower what the blocks need.',
          tools: PERF_TOOLS,
          target: { kind: 'block', id: bus.id },
        });
      } else if (demand > capacity * 0.7) {
        add('bus-busy', bus.id, 'tip', {
          title: `${bus.name} would be over 70% busy.`,
          why: 'This is simple arithmetic. Real traffic also loses time to overheads, so a busy bus may fall short.',
          how: 'Leave some spare [[bandwidth|bandwidth]], or simulate the traffic later.',
          tools: PERF_TOOLS,
          target: { kind: 'block', id: bus.id },
        });
      }
    });
  }

  function checkPortsAndNets(p, add) {
    const portTarget = (block, port) => ({ kind: 'port', blockId: block.id, id: port.id });
    const portAt = (blockId, portId) => CS.findPort(p.blocks.find((b) => b.id === blockId), portId);

    p.blocks.forEach((block) => {
      const seen = new Set();
      block.ports.forEach((port) => {
        if (seen.has(port.name)) {
          const taken = block.ports.map((x) => x.name);
          add('dup-port', port.id, 'fix', {
            title: `${block.name} has two [[port|ports]] called ${port.name}.`,
            why: 'RTL needs every port on a module to have its own name, so this design would not compile.',
            how: 'Rename one of them.',
            tools: 'Verilator, Yosys (both reject this when reading the RTL)',
            target: portTarget(block, port),
            fix: { label: 'Rename it for me', action: 'rename-port', blockId: block.id, portId: port.id, name: CS.uniqueName(port.name, taken) },
          });
        }
        seen.add(port.name);
        if (!CS.isLegalName(port.name)) {
          add('bad-port-name', port.id, 'warn', {
            title: `The port name "${port.name}" on ${block.name} cannot be used in RTL.`,
            why: 'Names must start with a letter or underscore, contain no spaces, and not be reserved words such as "wire".',
            how: 'Use letters, numbers and underscores.',
            target: portTarget(block, port),
            fix: { label: `Rename to ${CS.identifier(port.name)}`, action: 'rename-port', blockId: block.id, portId: port.id, name: CS.identifier(port.name) },
          });
        }
      });
    });

    const nets = new Map();
    p.links.forEach((l) => {
      if (!nets.has(l.net)) nets.set(l.net, []);
      nets.get(l.net).push(l);
    });
    nets.forEach((links, name) => {
      const first = links[0];
      if (!CS.isLegalName(name)) {
        add('bad-net-name', name, 'warn', {
          title: `The [[net|net]] name "${name}" cannot be used in RTL.`,
          why: 'Names must start with a letter or underscore, contain no spaces, and not be reserved words such as "wire".',
          how: 'Use letters, numbers and underscores.',
          target: { kind: 'link', id: first.id },
          fix: { label: `Rename to ${CS.identifier(name)}`, action: 'rename-net', oldName: name, name: CS.identifier(name) },
        });
      }
      const ports = new Map();
      links.forEach((l) => {
        [[l.from, l.fromPort], [l.to, l.toPort]].forEach(([blockId, portId]) => {
          const port = portAt(blockId, portId);
          if (port) ports.set(port.id, port);
        });
      });
      const all = [...ports.values()];
      const outputs = all.filter((x) => x.dir === 'out');
      if (outputs.length > 1) {
        add('net-multi-driver', name, 'fix', {
          title: `${outputs.length} outputs are driving the net ${name}.`,
          why: 'If two [[driver|drivers]] disagree, the wire has no clear value, and the chip can draw damaging current.',
          how: 'Give each output its own net, or combine them through a block that chooses between them.',
          tools: DRIVER_TOOLS,
          target: { kind: 'link', id: first.id },
        });
      }
      if (all.length && all.every((x) => x.dir === 'in')) {
        add('net-no-driver', name, 'fix', {
          title: `Nothing is driving the net ${name}.`,
          why: 'Every port on this net is an input, so nothing sets its value. It would float to an unknown level.',
          how: 'Connect an output to this net, or change one port’s direction.',
          tools: DRIVER_TOOLS,
          target: { kind: 'link', id: first.id },
        });
      }
      if (new Set(links.map((l) => l.width)).size > 1) {
        add('net-width-conflict', name, 'warn', {
          title: `The net ${name} is used with different widths.`,
          why: 'One net has one width. Connections with the same name are joined, so they must all match.',
          how: 'Give them the same width, or use different net names.',
          tools: 'Verilator (WIDTH warnings)',
          target: { kind: 'link', id: first.id },
        });
      }
    });

    p.links.forEach((l) => {
      const ends = [portAt(l.from, l.fromPort), portAt(l.to, l.toPort)].filter(Boolean);
      const off = ends.find((x) => x.width !== l.width);
      if (off) {
        add('port-width', l.id, 'warn', {
          title: `The port ${off.name} is ${off.width} bit${off.width === 1 ? '' : 's'}, but the net ${l.net} is ${l.width}.`,
          why: 'Mismatched widths silently cut off data or pad it with zeros.',
          how: 'Make the port and the net the same width.',
          tools: 'Verilator (WIDTHTRUNC, WIDTHEXPAND warnings)',
          target: { kind: 'link', id: l.id },
          fix: { label: `Use ${l.width} bit${l.width === 1 ? '' : 's'}`, action: 'set-width', linkId: l.id, width: l.width },
        });
      }
    });

    const loose = [];
    p.blocks.forEach((block) => {
      if (!p.links.some((l) => l.from === block.id || l.to === block.id)) return;
      block.ports.forEach((port) => {
        if (!port.external && port.dir !== 'out' && !CS.linksOnPort(p, port.id).length) {
          loose.push(`${block.name}.${port.name}`);
        }
      });
    });
    if (loose.length) {
      add('port-unconnected', '', 'tip', {
        title: `${loose.length} input${loose.length === 1 ? '' : 's'} not connected: ${loose.join(', ')}.`,
        why: 'An unconnected input floats to an unknown value in real hardware.',
        how: 'Connect each one, tie it to a fixed value in RTL, or delete the port.',
        tools: LINT_TOOLS,
        target: { kind: 'sketch' },
      });
    }
  }

  function checkBudgets(p, add) {
    const use = CS.usage(p);
    const pct = Math.round(use.areaShare * 100);
    if (use.areaShare > 1) {
      add('over-area', '', 'fix', {
        title: `Your design needs about ${pct}% of the available area.`,
        why: 'A design that does not fit cannot be built. On Tiny Tapeout, it fails to route and cannot be submitted.',
        how: 'Remove blocks, shrink memory, or choose a larger target in chip settings.',
        tools: 'OpenROAD (report_design_area, CORE_UTILIZATION), Innovus, Fusion Compiler',
        target: { kind: 'settings' },
      });
    } else if (use.areaShare > 0.8) {
      add('near-area', '', 'warn', {
        title: `Your design uses about ${pct}% of the available area.`,
        why: 'Size estimates at this stage are rough, and designs usually grow. A very full chip is also hard to route.',
        how: 'Leave some margin, or decide what you would cut first.',
        tools: 'OpenROAD (report_design_area, CORE_UTILIZATION), Innovus, Fusion Compiler',
        target: { kind: 'settings' },
      });
    }
    if (use.pins > p.limits.pins) {
      add('over-pins', '', 'fix', {
        title: `Your blocks need ${use.pins} [[pin|pins]], but this target has ${p.limits.pins}.`,
        why: 'Pins are fixed by the package. If you run out, some blocks cannot reach the outside world.',
        how: 'Remove a block, share pins between blocks, or choose a larger target.',
        target: { kind: 'settings' },
      });
    }
  }

  function checkPower(p, add) {
    p.links.forEach((l) => {
      const a = p.blocks.find((b) => b.id === l.from);
      const z = p.blocks.find((b) => b.id === l.to);
      if (a.power !== z.power && !l.isolated) {
        add('power-crossing', l.id, 'warn', {
          title: `${a.name} and ${z.name} are in different [[powerdomain|power domains]], with no protection between them.`,
          why: 'When one side is off, its outputs float and can corrupt the side still running. Different voltages can also damage cells.',
          how: 'Add [[isolation|isolation]] cells, plus [[levelshifter|level shifters]] if the voltages differ.',
          tools: 'UPF / IEEE 1801 (set_isolation, set_level_shifter)',
          target: { kind: 'link', id: l.id },
          fix: { label: 'Mark as protected', action: 'set-isolated', linkId: l.id },
        });
      }
    });
  }

  function checkFeatures(p, add) {
    const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    if (!p.blocks.length) return;
    if (!p.features.length) {
      add('no-features', '', 'warn', {
        title: 'You have not listed any features yet.',
        why: 'The feature list says what the chip must do. Without it, you cannot tell when you are finished.',
        how: 'Go to Features and add what the chip must do.',
        tools: PLAN_TOOLS,
        target: { kind: 'features' },
      });
      return;
    }
    const noBlock = p.features.filter((f) => !f.blockId);
    if (noBlock.length) {
      add('feature-no-block', '', 'warn', {
        title: `${count(noBlock.length, 'feature')} ${noBlock.length === 1 ? 'is' : 'are'} not assigned to a block.`,
        why: 'A feature with no block may have no hardware to carry it out.',
        how: 'Open each feature and choose its block.',
        tools: PLAN_TOOLS,
        target: { kind: 'features' },
      });
    }
    const noTest = p.features.filter((f) => f.must && !f.test.trim());
    if (noTest.length) {
      add('feature-no-test', '', 'tip', {
        title: `${count(noTest.length, 'must-have feature')} ${noTest.length === 1 ? 'has' : 'have'} no test idea.`,
        why: 'Deciding how you will test something now often exposes missing parts of the design.',
        how: 'Open each feature and write a sentence on how you will prove it works.',
        tools: PLAN_TOOLS,
        target: { kind: 'features' },
      });
    }
    const covered = new Set(p.features.map((f) => f.blockId));
    const idle = p.blocks.filter((b) => {
      return !['bus', 'support'].includes(CS.roleOf(b)) && !covered.has(b.id);
    });
    if (idle.length) {
      add('block-no-feature', '', 'tip', {
        title: `${count(idle.length, 'block')} ${idle.length === 1 ? 'has' : 'have'} no features: ${idle.map((b) => b.name).join(', ')}.`,
        why: 'Every block costs area. If it does not support a feature, you may not need it.',
        how: 'Add a feature for each block, or remove the block.',
        tools: PLAN_TOOLS,
        target: { kind: 'features' },
      });
    }
    const cpu = p.blocks.find((b) => b.type === 'cpu');
    if (cpu && !p.blocks.some((b) => b.type === 'debug')) {
      add('no-debug', '', 'tip', {
        title: 'Your processor has no debug port.',
        why: 'If software will not run on the finished chip, a debug port may be the only way to see why.',
        how: 'Add a debug port.',
        target: { kind: 'sketch' },
        fix: { label: 'Add a debug port', action: 'add-block', blockType: 'debug', connectTo: cpu.id },
      });
    }
  }

  const ORDER = { fix: 0, warn: 1, tip: 2 };

  function runChecks(p) {
    const issues = [];
    const add = (rule, id, severity, details) => {
      issues.push(Object.assign({
        key: `${rule}:${id}`, rule, severity, plainTitle: plain(details.title),
      }, details));
    };
    checkStructure(p, add);
    checkClocks(p, add);
    checkAddresses(p, add);
    checkBuses(p, add);
    checkPortsAndNets(p, add);
    checkBudgets(p, add);
    checkPower(p, add);
    checkFeatures(p, add);
    return issues
      .filter((i) => !p.ignored.includes(i.key))
      .sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  }

  // Every issue, including those marked "Not a problem". Exports use this, so that a
  // hidden problem can never make a design look cleaner than it is.
  function allIssues(p) {
    return runChecks(Object.assign({}, p, { ignored: [] }));
  }

  function hiddenIssues(p) {
    return allIssues(p).filter((i) => p.ignored.includes(i.key));
  }

  function applyFix(p, fix) {
    const link = p.links.find((l) => l.id === fix.linkId);
    switch (fix.action) {
      case 'auto-addresses': assignAddresses(p); return null;
      case 'set-crossing': link.crossing = fix.crossing; return null;
      case 'set-width': CS.setLinkWidth(p, link, fix.width); return null;
      case 'rename-net': CS.renameNet(p, fix.oldName, fix.name); return null;
      case 'rename-port': {
        const block = p.blocks.find((b) => b.id === fix.blockId);
        CS.findPort(block, fix.portId).name = fix.name;
        return null;
      }
      case 'set-protocol': link.protocol = fix.protocol; return null;
      case 'set-isolated': link.isolated = true; return null;
      case 'set-comb': link.comb = false; return null;
      case 'add-block': {
        const spot = CS.layout.freeSpotBelow(p);
        const block = CS.createBlock(p, fix.blockType, spot.x, spot.y);
        // A fix must not leave a new problem behind, such as an unconnected block.
        if (fix.connectTo) CS.createLink(p, block.id, fix.connectTo);
        return block;
      }
      default: throw new Error(`Unknown fix: ${fix.action}`);
    }
  }

  // Decides the headline on the Check screen. Only must-fix problems block readiness:
  // warnings and tips inform, so that the headline stays achievable for a beginner.
  function isReadyForRtl(issues) {
    return !issues.some((issue) => issue.severity === 'fix');
  }

  Object.assign(CS, { findCombLoop, runChecks, allIssues, hiddenIssues, applyFix, assignAddresses, addressable, isReadyForRtl });
}(window.CS));
