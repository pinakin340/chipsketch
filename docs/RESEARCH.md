# Research notes: ASIC design tools

Collected 2026-11-05. These notes record what each source supports and where the
research stopped short.

## What could and could not be read

"All the documentation" is not reachable. These limits shaped the tool:

| Source | Status |
| --- | --- |
| Synopsys, Cadence and Siemens tool manuals | **Behind customer logins.** Only product pages and marketing were readable. |
| Cummings CDC paper (SNUG 2008) | **Login required** at its current home. Only secondary summaries were read. |
| Arm AMBA AXI specification | **Page did not render** for the fetch tool. AXI rules are not encoded beyond "protocols must match". |
| IEEE 1801 (UPF) and IEEE 1685 (IP-XACT) standards | **Paid standards.** Accellera/DVCon slides and tool docs were used instead. |
| Yosys, Verilator, OpenROAD flow scripts, LibreLane, cocotb, PeakRDL, Tiny Tapeout | Open and read directly or via search extracts. |

## The flow, stage by stage

| Stage | Purpose | Open-source | Commercial |
| --- | --- | --- | --- |
| Architecture | Choose blocks, clocks, memory, buses | gem5, Kactus2, PeakRDL | Synopsys Platform Architect |
| RTL and lint | Write the design, catch structural mistakes | Verilator, Yosys `check` | VC SpyGlass, Questa Lint |
| CDC / RDC | Clock and reset crossings | (no mature equivalent found) | VC SpyGlass CDC/RDC, Questa CDC/RDC |
| Verification | Prove behaviour against the plan | cocotb, Verilator | VCS, Xcelium, Questa, UVM |
| Synthesis | RTL to gates | Yosys + ABC | Design Compiler, Fusion Compiler, Genus |
| DFT | Make silicon testable | Fault | Tessent, Modus |
| Place and route | Gates to layout | OpenROAD, ORFS, LibreLane | Fusion Compiler, IC Compiler II, Innovus |
| Sign-off | Final timing, physical and equivalence checks | OpenSTA, KLayout, Magic, Netgen | PrimeTime, Tempus, Calibre, IC Validator, Pegasus, Formality, Conformal |

Some commercial names above come from third-party lists, not vendor documentation.
Treat the table as a map and not as a statement of current product scope.

## Findings that became checks

| Finding | Source | Check in ChipSketch |
| --- | --- | --- |
| `check` finds combinational loops, conflicting drivers, and used wires with no driver | Yosys docs | Unconnected blocks, combinational loops |
| `UNDRIVEN`, `UNUSEDSIGNAL`, `WIDTH*`, `UNOPTFLAT`, `SYNCASYNCNET` warnings | Verilator docs | Unconnected blocks, width mismatch, loops, resets |
| `check` also finds conflicting drivers and undriven wires; `MULTIDRIVEN` warning | Yosys and Verilator docs | Nets with two outputs or no driver, port and net width mismatch |
| CDC and RDC are separate sign-off categories | Synopsys and Siemens product pages | Unhandled crossings, reset controller check |
| Multi-bit crossings use FIFOs, Gray codes or multi-cycle schemes | Secondary summaries of Cummings | Multi-bit signal on a two-flop synchronizer |
| Architecture tools sweep performance, interconnect and memory early | Platform Architect page | Bus bandwidth check (spreadsheet level, no simulation) |
| SystemRDL/IP-XACT capture register and memory maps | PeakRDL and Kactus2 docs | Address overlap and alignment |
| UPF strategies: isolation, level shifters, retention | Accellera UPF slides, DVCon | Power domain crossing check |
| Report area, slack, power; DRC report must be empty | OpenROAD FlowTutorial | Area budget, clock limit, roadmap items |
| Set coverage goals early; the plan traces spec to verification | MosChip, EnSilica | Features need a block and a test idea |
| About 1,000 gates per 160x100 um tile; failing GDS blocks submission | Tiny Tapeout FAQ | Tiny Tapeout area budget |
| Clock, reset, 8 in, 8 out, 8 bidirectional (26 pins) | Tiny Tapeout FAQ and GPIO spec | Pin budget |

## Estimates (rough, and editable in the app)

| Number | Basis | Confidence |
| --- | --- | --- |
| 16 um² per gate on Sky130 | 16,000 um² tile / about 1,000 gates (Tiny Tapeout) | Moderate |
| 200,000 um² per KB of memory on Sky130 | OpenRAM 1 KB macro, 479.78 x 397.5 um, about 190,700 um² (OpenLane tutorial) | Moderate. A Liberty file for a similar macro lists about 168,000. |
| 66 MHz Tiny Tapeout clock | Tiny Tapeout clock and GPIO specs | Moderate. The FAQ says "at least 50 MHz". |
| 100 MHz Sky130 clock | Engineering judgement; the OpenROAD tutorial's `ibex` runs near 57 MHz | Low |
| Block gate counts | Engineering judgement | Low. Starter values only. |
| All 28 nm numbers | Engineering judgement, no source | Low |

## Sources

- [OpenROAD flow scripts: variables](https://openroad-flow-scripts.readthedocs.io/en/latest/user/FlowVariables.html)
- [OpenROAD flow scripts: tutorial](https://openroad-flow-scripts.readthedocs.io/en/latest/tutorials/FlowTutorial.html)
- [OpenROAD flow scripts: user guide](https://openroad-flow-scripts.readthedocs.io/en/latest/user/UserGuide.html)
- [LibreLane documentation](https://librelane.readthedocs.io/en/latest/)
- [Verilator warnings](https://verilator.org/guide/latest/warnings.html)
- [Yosys `check`](https://yosyshq.readthedocs.io/projects/yosys/en/0.40/cmd/check.html)
- [Yosys `scc`](https://yosyshq.readthedocs.io/projects/yosys/en/v0.48/cmd/scc.html)
- [cocotb documentation](https://docs.cocotb.org/en/stable/)
- [PeakRDL-ipxact](https://peakrdl-ipxact.readthedocs.io/)
- [Kactus2 overview](https://www.linuxlinks.com/kactus2-graphical-eda-tool/)
- [Tiny Tapeout FAQ](https://tinytapeout.com/faq/)
- [Tiny Tapeout GPIO spec](https://tinytapeout.com/specs/gpio/)
- [Tiny Tapeout clock spec](https://tinytapeout.com/specs/clock/)
- [OpenLane OpenRAM tutorial](https://openlane-docs.readthedocs.io/en/latest/tutorials/openram.html)
- [Synopsys Platform Architect](https://www.synopsys.com/PlatformArchitect)
- [Synopsys IC Validator](https://synopsys.com/icvalidator)
- [Siemens Questa Design Solutions](https://verificationacademy.com/topics/questa-design-solutions)
- [Accellera: Low Power with UPF](https://accellera.org/images/resources/videos/Low_Power_with_UPF_2013.pdf)
- [MosChip verification methodology](https://moschip.com/blog/silicon-engineering-services/asic-and-soc-verification-a-comprehensive-methodology-guide/)
- [EnSilica: advanced ASIC verification](https://www.ensilica.com/?p=985)
- [AnySilicon: ASIC design flow](https://anysilicon.com/asic-design-flow/)
- [Cadence back-end flow webinar](https://community.cadence.com/cadence_blogs_8/b/di/posts/a-technical-webinar-on-synthesis-dft-lec-implementation-and-timing-signoff)
- [Signoff overview (Wikipedia)](https://www.wikipedia.org/wiki/Signoff_(EDA))
- [Clock domain crossing primer (ChipVerify)](https://chipverify.com/rtl-synthesis/clock-domain-crossing)
