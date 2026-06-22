# Development Docs

| Change type | Where |
|---|---|
| Small change, bug fix, config tweak | `docs/dev/changes/YYYY-MM-DD-slug.md` |
| New module / needs design first | `docs/superpowers/specs/` → `docs/superpowers/plans/` |
| Scratch notes while building | `docs/dev/wip/` — delete or promote before merge |

**Small = build then document. Big = design before building.**

Copy `docs/dev/changes/TEMPLATE.md` for every change. The `## Research` section is required — even one line. Always check latest docs, real production systems, and alternatives before writing code.
