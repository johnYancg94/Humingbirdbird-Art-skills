# 1.2.0 — 2026-11-10

- Full preflight before changes; accept either source surface-foreground name.
- Source-derived state counts, exact asset manifest, visibility and stacking verification.
- Shared Node validation engine for Python and JavaScript; reject nonpixel layers, duplicate groups, incorrect names and foreground numbering.
- Refresh and validate before a separate save, then verify again; conditional Smart Object rasterization.
- Mandatory request snapshot/document guards on explicit HTTP/MCP queues.
- Merge-ID remapping and structured partial failure results in the CEP adapter.
- Persistent run reports and complete dry-run plans; timeout is explicitly unknown execution, not cancellation.
- Installer reads release metadata from dependencies.json and verifies installed core file hashes.
- Portable regression tests and GitHub Actions; bridge source is maintained with the skill.

Regression coverage uses synthetic snapshots and isolated HTTP/CEP simulations. Photoshop application rendering and large-document performance require a separate live acceptance run after restarting the updated plugin. Do not describe offline tests as pixel-equivalence proof.
