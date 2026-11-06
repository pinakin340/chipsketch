# Contributing to ChipSketch

Contributions are welcome, especially from people learning chip design. If something
confused you, that is worth reporting too.

## Running it

There is nothing to install or build. Open `index.html` in a browser.

## Running the tests

Open `tests/run.html` in a browser, or run this if you have Chrome, Chromium or Edge:

```bash
bash scripts/test.sh
```

The tests cover the rules, layout, file loading and exports. They do not cover the
interface in `js/app.js`, so please also try any change in the app by hand.

## Where things live

| File | Holds |
| --- | --- |
| `js/knowledge.js` | Block types, targets, glossary, roadmap and templates, as data |
| `js/model.js` | Project data, safe file loading, and the spec and SDC exports |
| `js/checks.js` | The architecture rules |
| `js/layout.js` | Diagram geometry and wire routing |
| `js/verilog.js` | The Verilog export |
| `js/app.js` | Screens and interaction |

## Ground rules

- **Keep it beginner-friendly.** One screen, one job, and one problem at a time. Extra
  options go under "More options", or are left out. `docs/PLAN.md` has the full design rules.
- **Keep it dependency-free.** It should keep working by double-clicking `index.html`.
- **Add a test** for each new rule or bug fix.
- **Explain every new check in plain language:** what is wrong, why it matters, how to fix it.
- **Treat project files as untrusted.** They may come from someone else. Project text must go
  through `esc()` before it reaches the page.
