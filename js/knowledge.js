// Research turned into data. Nothing in this file has behaviour.
// Numbers marked "ballpark" are starter values. See docs/RESEARCH.md for their basis.
window.CS = window.CS || {};

// One port on a block. dir: 'in', 'out', 'inout', or 'bus' for a whole bus interface.
// A port with external set goes to a pin on the edge of the chip.
const port = (name, dir, width, external) => ({ name, dir, width: width || 1, external: !!external });

CS.BLOCK_TYPES = {
  cpu: {
    label: 'Processor', group: 'core', role: 'manager', gates: 15000, addr: false,
    tag: 'Processor',
    ports: [port('m_bus', 'bus', 32), port('irq', 'in'), port('dbg', 'in', 4)],
    what: 'Runs your software and gives orders to the other blocks.',
    features: ['starts running code after reset', 'reads and writes memory', 'responds to an interrupt'],
  },
  memory: {
    label: 'Memory', group: 'core', role: 'subordinate', gates: 0, addr: true, memKB: 4,
    tag: 'SRAM',
    ports: [port('s_bus', 'bus', 32)],
    what: 'Stores data and code while the chip is powered.',
    features: ['keeps a value that was written to it', 'works at every address in its range'],
  },
  bus: {
    label: 'Bus', group: 'core', role: 'bus', gates: 1500, addr: false,
    tag: 'Interconnect',
    ports: [],
    what: 'A shared road that lets blocks talk to each other.',
    features: [],
  },
  accel: {
    label: 'Accelerator', group: 'core', role: 'both', gates: 20000, addr: true, mbps: 100,
    tag: 'Accelerator',
    ports: [port('m_dma', 'bus', 32), port('s_cfg', 'bus', 32)],
    what: 'Does one heavy job much faster than the processor could.',
    features: ['finishes its job and signals when it is done', 'gives the same answer as a software model'],
  },
  uart: {
    label: 'UART', group: 'io', role: 'subordinate', gates: 600, addr: true,
    tag: 'Peripheral',
    ports: [port('s_bus', 'bus', 32), port('tx', 'out', 1, true), port('rx', 'in', 1, true)],
    what: 'Sends and receives text over two wires. Handy for debugging.',
    features: ['sends a byte at the chosen speed', 'receives a byte at the chosen speed'],
  },
  spi: {
    label: 'SPI', group: 'io', role: 'subordinate', gates: 800, addr: true,
    tag: 'Peripheral',
    ports: [port('s_bus', 'bus', 32), port('sclk', 'out', 1, true), port('mosi', 'out', 1, true), port('miso', 'in', 1, true), port('cs_n', 'out', 1, true)],
    what: 'Talks quickly to sensors, screens and flash chips.',
    features: ['exchanges a byte with a connected device'],
  },
  i2c: {
    label: 'I2C', group: 'io', role: 'subordinate', gates: 900, addr: true,
    tag: 'Peripheral',
    ports: [port('s_bus', 'bus', 32), port('scl', 'inout', 1, true), port('sda', 'inout', 1, true)],
    what: 'Talks to many small devices over two shared wires.',
    features: ['reads a register from a connected device'],
  },
  gpio: {
    label: 'GPIO', group: 'io', role: 'subordinate', gates: 300, addr: true,
    tag: 'Peripheral',
    ports: [port('s_bus', 'bus', 32), port('io', 'inout', 8, true)],
    what: 'Plain pins you can switch on and off or read, such as for LEDs and buttons.',
    features: ['drives each pin high and low', 'reads the level on each pin'],
  },
  timer: {
    label: 'Timer', group: 'support', role: 'subordinate', gates: 400, addr: true,
    tag: 'Peripheral',
    ports: [port('s_bus', 'bus', 32), port('irq', 'out')],
    what: 'Counts clock cycles so the chip can measure time.',
    features: ['raises a signal after a set time'],
  },
  pll: {
    label: 'Clock generator', group: 'support', role: 'support', gates: 200, addr: false,
    tag: 'Clocking',
    ports: [port('clk_in', 'in', 1, true), port('clk_out', 'out')],
    what: 'Makes faster or slower clocks from one input clock. Often called a PLL.',
    features: [],
  },
  reset: {
    label: 'Reset controller', group: 'support', role: 'support', gates: 100, addr: false,
    tag: 'Reset',
    ports: [port('rst_in', 'in', 1, true), port('rst_out', 'out')],
    what: 'Starts every block cleanly and releases reset safely in each clock domain.',
    features: ['every block starts in a known state'],
  },
  debug: {
    label: 'Debug port', group: 'support', role: 'manager', gates: 2500, addr: false,
    tag: 'Debug',
    ports: [port('jtag', 'in', 4, true), port('dbg', 'out', 4)],
    what: 'Lets you pause the processor and inspect the chip from a computer.',
    features: ['halts the processor and reads its state'],
  },
  custom: {
    label: 'My own block', group: 'core', role: 'both', gates: 1000, addr: true,
    tag: 'Custom block',
    ports: [port('in', 'in', 8), port('out', 'out', 8)],
    what: 'Anything else your chip needs. You decide what it does.',
    features: [],
  },
};

CS.BLOCK_GROUPS = [
  { id: 'core', label: 'Core' },
  { id: 'io', label: 'Outside world' },
  { id: 'support', label: 'Support' },
];

// areaMm2, pins, maxMHz, gateUm2 and kbUm2 become editable budgets on the project.
CS.TARGETS = {
  tt: {
    name: 'Tiny Tapeout',
    blurb: 'A shared low-cost chip. Very small, and the easiest way to start.',
    areaMm2: 0.016, pins: 24, maxMHz: 66, gateUm2: 16, kbUm2: 200000,
  },
  sky130: {
    name: 'Small open-source chip',
    blurb: 'Your own small chip on the open Sky130 process. Room for a processor.',
    areaMm2: 10, pins: 38, maxMHz: 100, gateUm2: 16, kbUm2: 200000,
  },
  n28: {
    name: 'Commercial 28 nm',
    blurb: 'A professional process. Numbers here are ballpark only.',
    areaMm2: 25, pins: 200, maxMHz: 1000, gateUm2: 1, kbUm2: 3000,
  },
};

CS.PROTOCOLS = {
  wires: 'Simple wires',
  apb: 'APB (simple and slow)',
  'axi-lite': 'AXI-Lite (common)',
  axi: 'AXI (fast)',
  wishbone: 'Wishbone (open-source)',
};

CS.PROTOCOL_TAGS = {
  wires: 'Wires', apb: 'APB', 'axi-lite': 'AXI-Lite', axi: 'AXI', wishbone: 'Wishbone',
};

CS.PORT_DIRS = {
  in: 'Input',
  out: 'Output',
  inout: 'Both ways',
  bus: 'Bus interface',
};

// Words Verilog and SystemVerilog reserve, which cannot be used as names. SystemVerilog
// is included because tools such as Verilator read Verilog files as SystemVerilog by default.
CS.VERILOG_KEYWORDS = new Set([
  'always', 'and', 'assert', 'assign', 'assume', 'automatic', 'before', 'begin', 'bind',
  'bins', 'binsof', 'bit', 'break', 'buf', 'bufif0', 'bufif1', 'byte', 'case', 'casex',
  'casez', 'cell', 'chandle', 'checker', 'class', 'clocking', 'cmos', 'config', 'const',
  'constraint', 'context', 'continue', 'cover', 'covergroup', 'coverpoint', 'cross',
  'deassign', 'default', 'defparam', 'design', 'disable', 'dist', 'do', 'edge', 'else', 'end',
  'endcase', 'endchecker', 'endclass', 'endclocking', 'endconfig', 'endfunction',
  'endgenerate', 'endgroup', 'endinterface', 'endmodule', 'endpackage', 'endprimitive',
  'endprogram', 'endproperty', 'endsequence', 'endspecify', 'endtable', 'endtask', 'enum',
  'event', 'eventually', 'expect', 'export', 'extends', 'extern', 'final', 'first_match',
  'for', 'force', 'foreach', 'forever', 'fork', 'forkjoin', 'function', 'generate', 'genvar',
  'global', 'highz0', 'highz1', 'if', 'iff', 'ifnone', 'ignore_bins', 'illegal_bins',
  'implements', 'implies', 'import', 'incdir', 'include', 'initial', 'inout', 'input',
  'inside', 'instance', 'int', 'integer', 'interconnect', 'interface', 'intersect', 'join',
  'join_any', 'join_none', 'large', 'let', 'liblist', 'library', 'local', 'localparam',
  'logic', 'longint', 'macromodule', 'matches', 'medium', 'modport', 'module', 'nand',
  'negedge', 'nettype', 'new', 'nexttime', 'nmos', 'nor', 'noshowcancelled', 'not', 'notif0',
  'notif1', 'null', 'or', 'output', 'package', 'packed', 'parameter', 'pmos', 'posedge',
  'primitive', 'priority', 'program', 'property', 'protected', 'pull0', 'pull1', 'pulldown',
  'pullup', 'pulsestyle_ondetect', 'pulsestyle_onevent', 'pure', 'rand', 'randc', 'randcase',
  'randsequence', 'rcmos', 'real', 'realtime', 'ref', 'reg', 'reject_on', 'release', 'repeat',
  'restrict', 'return', 'rnmos', 'rpmos', 'rtran', 'rtranif0', 'rtranif1', 's_always',
  's_eventually', 's_nexttime', 's_until', 's_until_with', 'scalared', 'sequence', 'shortint',
  'shortreal', 'showcancelled', 'signed', 'small', 'soft', 'solve', 'specify', 'specparam',
  'static', 'string', 'strong', 'strong0', 'strong1', 'struct', 'super', 'supply0', 'supply1',
  'sync_accept_on', 'sync_reject_on', 'table', 'tagged', 'task', 'this', 'throughout', 'time',
  'timeprecision', 'timeunit', 'tran', 'tranif0', 'tranif1', 'tri', 'tri0', 'tri1', 'triand',
  'trior', 'trireg', 'type', 'typedef', 'union', 'unique', 'unique0', 'unsigned', 'until',
  'until_with', 'untyped', 'use', 'uwire', 'var', 'vectored', 'virtual', 'void', 'wait',
  'wait_order', 'wand', 'weak', 'weak0', 'weak1', 'while', 'wildcard', 'wire', 'with',
  'within', 'wor', 'xnor', 'xor',
]);

CS.CROSSINGS = {
  none: 'Not decided yet',
  '2ff': 'Two flip-flops (one wire only)',
  handshake: 'Handshake (occasional data)',
  fifo: 'Async FIFO (streams of data)',
};

CS.GLOSSARY = {
  architecture: 'The plan for a chip: which blocks it has and how they connect.',
  port: 'A named connection point on a block, such as tx or irq. In RTL, it is a line in the module header.',
  net: 'A named wire, or group of wires, between ports. All connections with the same net name are one net.',
  pad: 'The spot on the edge of the chip where a signal leaves for the outside world.',
  driver: 'The output that sets a net’s value. A net needs exactly one.',
  rtl: 'Code that describes what the chip does on each clock tick, usually written in Verilog.',
  cdc: 'A signal moving between blocks that run on different clocks. Done carelessly, it corrupts data at random.',
  clockdomain: 'A group of blocks that share one clock.',
  synchronizer: 'Flip-flops that give a signal time to settle after it arrives from another clock.',
  fifo: 'A small queue. An async FIFO lets data pass safely between two clocks.',
  metastability: 'When a flip-flop samples a changing signal and briefly holds neither 0 nor 1.',
  manager: 'A block that starts requests, such as a processor.',
  subordinate: 'A block that answers requests, such as memory.',
  bus: 'Shared wires and rules that let several blocks talk to each other.',
  address: 'The number a processor uses to choose which block it is talking to.',
  bandwidth: 'How much data a connection can carry each second.',
  combloop: 'Logic that feeds back into itself with no flip-flop in between. It can oscillate forever.',
  lint: 'An automatic review of RTL that finds likely mistakes without running it.',
  sta: 'Static timing analysis. It proves every signal arrives in time, without simulating.',
  synthesis: 'Turning RTL into a list of real logic gates.',
  pnr: 'Place and route. Positioning every gate on the chip and drawing the wires between them.',
  dft: 'Design for test. Extra logic that lets the factory check each chip works.',
  drc: 'Design rule check. Confirms the layout follows the factory’s manufacturing rules.',
  lvs: 'Layout versus schematic. Confirms the layout matches the intended circuit.',
  gds: 'The final layout file sent to the factory.',
  tapeout: 'Sending the finished design to be manufactured.',
  powerdomain: 'A group of blocks that can be powered off together to save energy.',
  isolation: 'Cells that hold a safe value on signals coming from a block that is powered off.',
  levelshifter: 'A cell that converts a signal between two different voltages.',
  sdc: 'A standard file that tells tools your clock speeds and timing rules.',
  gate: 'A tiny logic circuit, such as AND or OR. Chip size is often counted in gates.',
  pin: 'A connection from the chip to the outside world.',
};

// The doc links here were all found during research (docs/RESEARCH.md).
CS.ROADMAP = [
  {
    id: 'arch', title: 'Plan the architecture',
    what: 'Decide which blocks your chip needs and how they connect. You are here.',
    items: [
      'My sketch has no must-fix problems',
      'Every must-have feature has a block and a test idea',
      'I know which features I would cut if the chip gets too big',
    ],
    open: ['This tool', 'gem5', 'Kactus2', 'PeakRDL'],
    paid: ['Synopsys Platform Architect'],
    docs: [
      ['PeakRDL', 'https://peakrdl-ipxact.readthedocs.io/'],
      ['Platform Architect', 'https://www.synopsys.com/PlatformArchitect'],
    ],
  },
  {
    id: 'rtl', title: 'Write and lint the RTL',
    what: 'Write each block in code, then let a [[lint|lint tool]] look for likely mistakes. To get started, use Menu > Export top-level Verilog.',
    items: [
      'Every block in the sketch exists as a module',
      'Lint runs with no unexplained warnings',
      'Clock crossings have been reviewed',
    ],
    open: ['Verilator', 'Yosys check'],
    paid: ['VC SpyGlass', 'Questa Lint', 'Questa CDC'],
    docs: [
      ['Verilator warnings', 'https://verilator.org/guide/latest/warnings.html'],
      ['Yosys check', 'https://yosyshq.readthedocs.io/projects/yosys/en/0.40/cmd/check.html'],
    ],
  },
  {
    id: 'verify', title: 'Test that it works',
    what: 'Run simulations that try each feature and compare the results with what you expect.',
    items: [
      'Every must-have feature has a passing test',
      'Tests re-run automatically after each change',
      'Coverage goals were set before testing began',
    ],
    open: ['cocotb', 'Verilator'],
    paid: ['VCS', 'Xcelium', 'Questa', 'UVM (a method, used with these)'],
    docs: [['cocotb', 'https://docs.cocotb.org/en/stable/']],
  },
  {
    id: 'synth', title: 'Turn code into gates',
    what: '[[synthesis|Synthesis]] converts your RTL into logic gates. It needs an [[sdc|SDC file]] that states your clocks.',
    items: [
      'Synthesis finishes with no errors',
      'The gate count is close to the estimate in my sketch',
      'Timing constraints cover every clock',
    ],
    open: ['Yosys + ABC'],
    paid: ['Design Compiler', 'Fusion Compiler', 'Genus'],
    docs: [['Flow variables', 'https://openroad-flow-scripts.readthedocs.io/en/latest/user/FlowVariables.html']],
  },
  {
    id: 'dft', title: 'Make it testable',
    what: 'Add [[dft|test logic]] so that each manufactured chip can be checked.',
    items: [
      'I decided how each chip will be tested',
      'Test logic is included, or I recorded why it is not needed',
    ],
    open: ['Fault'],
    paid: ['Tessent', 'Modus'],
    docs: [],
  },
  {
    id: 'pnr', title: 'Lay out the chip',
    what: '[[pnr|Place and route]] positions every gate and draws every wire.',
    items: [
      'Layout finishes with no routing congestion errors',
      'The design area fits my budget',
      'Clock tree is built and skew is reviewed',
    ],
    open: ['OpenROAD', 'OpenROAD flow scripts', 'LibreLane'],
    paid: ['Fusion Compiler', 'IC Compiler II', 'Innovus'],
    docs: [
      ['OpenROAD tutorial', 'https://openroad-flow-scripts.readthedocs.io/en/latest/tutorials/FlowTutorial.html'],
      ['LibreLane', 'https://librelane.readthedocs.io/en/latest/'],
    ],
  },
  {
    id: 'signoff', title: 'Final checks',
    what: 'The last checks before manufacture: [[sta|timing]], [[drc|DRC]], [[lvs|LVS]] and power.',
    items: [
      'Setup and hold timing pass',
      'The DRC report is empty',
      'LVS passes',
      'Final netlist still matches the RTL',
    ],
    open: ['OpenSTA', 'KLayout', 'Magic', 'Netgen'],
    paid: ['PrimeTime', 'Tempus', 'Calibre', 'IC Validator', 'Pegasus', 'Formality', 'Conformal'],
    docs: [['OpenROAD tutorial', 'https://openroad-flow-scripts.readthedocs.io/en/latest/tutorials/FlowTutorial.html']],
  },
  {
    id: 'tapeout', title: 'Send it to the factory',
    what: '[[tapeout|Tape-out]] sends your [[gds|GDS file]] for manufacture. Then you test real chips.',
    items: [
      'The GDS passes the factory or shuttle checks',
      'I have a plan for testing the chip when it arrives',
    ],
    open: ['Tiny Tapeout'],
    paid: ['Foundry-specific flows'],
    docs: [['Tiny Tapeout FAQ', 'https://tinytapeout.com/faq/']],
  },
];

const feat = (title, blockId, test, status) => ({ title, blockId, test: test || '', status: status || 'todo', must: true });

CS.TEMPLATES = {
  blank: {
    name: 'Blank page',
    blurb: 'Start with nothing and add blocks yourself.',
    target: 'tt',
    clocks: [{ id: 'c1', name: 'clk', mhz: 25 }],
    blocks: [], links: [], features: [],
  },
  tiny: {
    name: 'LED pattern maker',
    blurb: 'A tiny chip with no processor that blinks LEDs in a pattern.',
    target: 'tt',
    clocks: [{ id: 'c1', name: 'clk', mhz: 25 }],
    blocks: [
      { id: 'b1', type: 'timer', name: 'Tick timer', clock: 'c1', gates: 200, ports: [port('tick', 'out')] },
      { id: 'b2', type: 'custom', name: 'Pattern maker', clock: 'c1', gates: 300, ports: [port('tick', 'in'), port('pattern', 'out', 8)] },
      { id: 'b3', type: 'gpio', name: 'LED pins', clock: 'c1', gates: 150, ports: [port('pattern', 'in', 8), port('led', 'out', 8, true)] },
    ],
    links: [
      { id: 'l1', from: 'b1', to: 'b2', protocol: 'wires', width: 1, net: 'tick' },
      { id: 'l2', from: 'b2', to: 'b3', protocol: 'wires', width: 8, net: 'pattern' },
    ],
    features: [
      feat('Tick timer: pulses about ten times a second', 'b1', 'Count clock cycles between pulses in simulation'),
      feat('Pattern maker: moves to the next pattern on each tick', 'b2', 'Check the first 8 patterns against a list'),
    ],
  },
  micro: {
    name: 'Small microcontroller',
    blurb: 'A processor, memory and common peripherals on one bus.',
    target: 'sky130',
    clocks: [{ id: 'c1', name: 'clk_main', mhz: 50 }],
    blocks: [
      { id: 'b1', type: 'cpu', name: 'Processor', clock: 'c1' },
      { id: 'b2', type: 'debug', name: 'Debug port', clock: 'c1' },
      { id: 'b3', type: 'reset', name: 'Reset controller', clock: 'c1' },
      { id: 'b4', type: 'bus', name: 'Main bus', clock: 'c1' },
      { id: 'b5', type: 'memory', name: 'Memory', clock: 'c1', baseAddr: 0 },
      { id: 'b6', type: 'uart', name: 'UART', clock: 'c1', baseAddr: 0x10000000 },
      { id: 'b7', type: 'gpio', name: 'GPIO', clock: 'c1', baseAddr: 0x10001000 },
      { id: 'b8', type: 'timer', name: 'Timer', clock: 'c1', baseAddr: 0x10002000 },
    ],
    links: [
      { id: 'l1', from: 'b1', to: 'b4', protocol: 'axi-lite', width: 32 },
      { id: 'l2', from: 'b2', to: 'b1', protocol: 'wires', width: 4 },
      { id: 'l3', from: 'b4', to: 'b5', protocol: 'axi-lite', width: 32 },
      { id: 'l4', from: 'b4', to: 'b6', protocol: 'axi-lite', width: 32 },
      { id: 'l5', from: 'b4', to: 'b7', protocol: 'axi-lite', width: 32 },
      { id: 'l6', from: 'b4', to: 'b8', protocol: 'axi-lite', width: 32 },
      { id: 'l7', from: 'b8', to: 'b1', protocol: 'wires', width: 1, net: 'timer_irq' },
    ],
    features: [
      feat('Processor: starts running code after reset', 'b1', 'Run a small program that writes a known value'),
      feat('UART: sends a byte at the chosen speed', 'b6', 'Decode the transmit pin in simulation'),
      feat('GPIO: drives each pin high and low', 'b7', ''),
    ],
  },
  practice: {
    name: 'Practice: spot the mistakes',
    blurb: 'A chip with mistakes planted in it. The Check screen walks you through them.',
    target: 'sky130',
    clocks: [{ id: 'c1', name: 'clk_main', mhz: 50 }, { id: 'c2', name: 'clk_fast', mhz: 200 }],
    blocks: [
      { id: 'b1', type: 'cpu', name: 'Processor', clock: 'c1' },
      { id: 'b2', type: 'bus', name: 'Main bus', clock: 'c1' },
      { id: 'b3', type: 'memory', name: 'Memory', clock: 'c1', baseAddr: 0 },
      { id: 'b4', type: 'uart', name: 'UART', clock: 'c1', baseAddr: 0 },
      {
        id: 'b5', type: 'accel', name: 'Image accelerator', clock: 'c2', baseAddr: 0x20000000, mbps: 400,
        ports: [port('m_dma', 'bus', 32), port('s_cfg', 'bus', 32), port('pixels', 'in', 8)],
      },
      {
        id: 'b6', type: 'custom', name: 'Camera input', clock: 'c1',
        ports: [port('cam_data', 'in', 8, true), port('pixels', 'out', 8)],
      },
      { id: 'b7', type: 'gpio', name: 'GPIO', clock: 'c1' },
    ],
    links: [
      { id: 'l1', from: 'b1', to: 'b2', protocol: 'axi-lite', width: 32 },
      { id: 'l2', from: 'b2', to: 'b3', protocol: 'axi-lite', width: 32 },
      { id: 'l3', from: 'b2', to: 'b4', protocol: 'axi-lite', width: 8 },
      { id: 'l4', from: 'b5', to: 'b2', protocol: 'axi-lite', width: 32 },
      { id: 'l5', from: 'b6', to: 'b5', protocol: 'wires', width: 8, crossing: '2ff', net: 'camera data' },
    ],
    features: [feat('Detect edges in a camera image', null, '')],
  },
};
