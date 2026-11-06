# ChipSketch plan

## Goal

A beginner can sketch a chip's architecture, get plain-language feedback on it, and
track what still has to be built. It is a planning aid. It reads no RTL and replaces
no EDA tool.

## Rules for keeping the screen quiet

1. **One screen, one job.** Sketch, Check, Features, Roadmap.
2. **One question at a time** when starting a project.
3. **One problem at a time** on the Check screen, with a pager.
4. **One suggestion at a time** on the Features screen.
5. **One roadmap stage open at a time.**
6. **Fields appear only when relevant.** Crossing options show only if the two blocks
   have different clocks. Advanced fields sit under "More options".
7. **One view at a time.** Wiring, Clocks or Memory map. Zooming far out hides names.
   Everything on the diagram moves with the same gesture: drag it.
8. **Jargon is clickable.** Dotted terms open a one-sentence definition.
9. **Mistakes are cheap.** Undo, autosave, and "Fix it for me" where a fix is safe.

## Screens

| Screen | Job | Default view |
| --- | --- | --- |
| Sketch | View and edit the architecture diagram | Chip outline, blocks with named ports, routed named nets, one view at a time |
| Check | Review the design | A verdict and one problem card |
| Features | Checklist of what to implement | Progress line, unfinished features |
| Roadmap | Steps from sketch to silicon | Eight stages, one open |

## Files

| File | Holds |
| --- | --- |
| `index.html` | Page shell |
| `styles.css` | Look and layout |
| `js/knowledge.js` | Research as data: block types, targets, glossary, roadmap, templates |
| `js/model.js` | Project data, ports and nets, and safe file loading |
| `js/layout.js` | Diagram geometry: block sizes, wire routing, pads, tidy-up |
| `js/checks.js` | The architecture rules, as pure functions |
| `js/verilog.js` | Top-level Verilog export |
| `js/app.js` | Screens and interaction |
| `tests/run.html` | Check-engine tests, run in a browser |
| `scripts/test.sh` | Runs those tests in a headless browser, locally and on GitHub |

## Limits

- Area, clock and gate numbers are rough estimates. See `RESEARCH.md`.
- The bandwidth check is arithmetic, not simulation.
- Clock and reset pins are not drawn as ports. They are shown in the Clocks view.
- Ports face the block they connect to, unless moved by hand, instead of always having inputs on the left.
- A net name with no clear spot beside its wire is left off the diagram, and shows on hover and in the panel.
- Power domains and combinational-loop settings have no controls. Their rules only run on older files that set them.
- Wire routing is a simple search for clear paths, so a crowded design can still have crossings.
- Autosave uses browser storage with no encryption. On `file://`, Edge shares that storage between local HTML files, and a client-only app has nowhere safe to keep a key. Only a separate origin or browser profile isolates it.
- The Verilog export is structure only. Blocks are empty, and bus interfaces are placeholder vectors.
- Links run in one direction and combinational loops are found per link, not per bit.
- A clean result means the sketch has no known mistakes. It does not mean the chip
  will work.
