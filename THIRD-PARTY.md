# Third-party components

No upstream source is vendored here. Everything is resolved from
`package-lock.json`, which is committed and is the authoritative record.

**Running this raises no licensing question.** The obligations attach when you
redistribute a **built image** or a compiled bundle, because those combine the
MIT-licensed code here with the packages below.

The dependency surface is small and almost entirely permissive: **81 production
packages, 66 of them MIT**. Nothing is GPL or AGPL.

## What the built image contains

| Component | Pinned | License |
|---|---|---|
| [node:22-bookworm-slim](https://hub.docker.com/_/node) | `22-bookworm-slim` | MIT (Node) + Debian base, mixed |
| 81 npm packages, resolved from `package-lock.json` | see below | see below |

## Licence tally, production tree only

| License | Packages |
|---|---|
| MIT | 69 |
| MPL-2.0 | 3 |
| BSD-2-Clause | 3 |
| BSD-3-Clause | 2 |
| ISC | 2 |
| Apache-2.0 | 1 |
| MIT-0 | 1 |

Nothing resolves to `UNKNOWN`, which is the property worth preserving: a single
undeclared package is indistinguishable from an unlicensed one to any scanner
auditing this tree.

Regenerate this tally at any time:

```bash
npm ls --omit=dev --all --parseable | tail -n +2 | while read -r d; do
  [ -f "$d/package.json" ] && node -p "
    (p => (typeof p.license === 'string' ? p.license : (p.license||{}).type) || 'UNKNOWN')
    (require('$d/package.json'))"
done | sort | uniq -c | sort -rn
```

## The weak-copyleft packages

Three of the 81 are **MPL-2.0**. MPL is file-level copyleft: modifying an MPL
file obliges you to publish that file's source, but merely depending on it —
which is all that happens here — does not affect your own code's licence.

| Package | Version | License | Why it is here |
|---|---|---|---|
| `axe-core` | 4.11.3 | MPL-2.0 | The accessibility rule engine. This is the substance of the tool, not an incidental dependency. |
| `@resvg/resvg-js` | 2.6.2 | MPL-2.0 | SVG rasterisation |
| `@resvg/resvg-js-darwin-arm64` | 2.6.2 | MPL-2.0 | Prebuilt native binary for the above; a different platform binary is installed on Linux |

If you bundle `axe-core` into a browser build you are redistributing MPL code —
keep its licence header intact, which every standard bundler does by default.

## Direct dependencies

**`packages/core`** — `@libretexts/cxone-expert-node` 1.4.0 (MIT) ·
`@resvg/resvg-js` 2.6.2 (MPL-2.0) · `axe-core` 4.11.3 (MPL-2.0) · `diff` 9.0.0
(BSD-3-Clause) · `dotenv` 16.6.1 (BSD-2-Clause) · `jsdom` 25.0.1 (MIT) ·
`parse5` 7.3.0 (MIT)

**`packages/cli`** — `commander` 12.1.0 (MIT) · `dotenv` 16.6.1 (BSD-2-Clause) ·
`kleur` 4.1.5 (MIT)

**`packages/conductor-panel`** — `react` 18.3.1 (MIT) · `react-dom` 18.3.1 (MIT)

## The workspaces declare their own licence

`@libretexts/remedy-core`, `@libretexts/remedy-cli` and
`@libretexts/remedy-conductor-panel` each carry `"license": "MIT"` in their
`package.json`, matching the repository `LICENSE`.

This is worth stating because it was not always true: the field was missing, and
tooling reported all three as `UNKNOWN` — a scanner cannot tell an undeclared
package from an unlicensed one. Keep the field when adding a workspace.

## Content this software touches

The bridge reads and writes LibreTexts course content through the CXone Expert
API. **That content is not covered by this repository's licence** — it carries
whatever terms the source material carries, and this MIT grant says nothing
about it.

## Why this repository is MIT

Everything under `packages/` is original work. Nothing here contains or modifies
copyleft source; MPL-2.0 packages are consumed as unmodified dependencies.
