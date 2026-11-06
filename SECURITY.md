# Security

ChipSketch runs entirely in your browser. It has no server, accounts or network requests.

## Reporting a problem

Please use **Report a vulnerability** under this repository's Security tab, so that it can
be fixed before it is public. If that option isn't available, open an issue asking for a
private way to get in touch, without including the details.

## Known limitations

**Autosave is not private.** Your work is saved in your browser's storage without encryption.
When ChipSketch runs from a local file, Edge shares that storage between all local HTML files,
so another HTML file you open could read or replace your saved chip. Other browsers may differ.
An app with no server has nowhere safe to keep an encryption key, so this can't be fixed in
the app. For sensitive designs, use a separate browser profile, or host ChipSketch at its own
address. A GitHub Pages project site is not a separate address, because it shares one with
every other project page on the same account.

**Exports are starting points.** Exported Verilog has empty blocks and placeholder bus
vectors. Review generated files before using them in a real flow, especially if the project
came from someone else.

**Project files may come from anyone.** Opening one replaces your current chip, with no
confirmation, so save your own work first. Files cannot run code in the page, and anything a
file marked as "Not a problem" is shown again when you open it.

## Review so far

Version 0.1.0 had one source-only security review, run by AI agents using Cloudflare's
`security-audit` skill on its quick profile. It found no path to script execution, and its
leads were then fixed or, for autosave, reduced. Treat this as limited assurance: the review
was partial, the fixes were not independently re-reviewed, and no outside security firm has
looked at this code.

Not yet reviewed: whether names written into Verilog comments can act as tool directives, and
whether very large project files can stall the page.
