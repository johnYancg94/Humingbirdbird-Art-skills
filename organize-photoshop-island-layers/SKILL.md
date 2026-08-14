---
name: organize-photoshop-island-layers
description: Install the required Photoshop Codex Bridge, then inspect, rename, merge, regroup, color-label, rasterize, and verify Photoshop PSD/PSB layer trees for five-region 2D game islands. Use when Codex must install this workflow, organize an island slicing document from an island slug and a building naming table, separate background and building foregrounds, normalize restored and ruined assets, or audit a finished island PSD/PSB against the delivery standard.
---

# Organize Photoshop Island Layers

Organize the active island PSD/PSB through a Photoshop layer-control tool. Preserve artwork while producing a deterministic, export-ready layer tree.

## Install The Required Bridge

This Skill has a required Windows dependency declared in [dependencies.json](dependencies.json). During Skill installation, before reporting success:

1. Install the Skill folder into the Agent's normal Skills directory.
2. Run the bundled installer from that installed folder:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "<installed-skill-directory>\scripts\install_photoshop_bridge.ps1"
```

3. Require the script's final JSON result to contain `"ok": true`, `"installed": true`, and the version declared in `dependencies.json`.
4. If `photoshopRestartRequired` or `agentRestartRequired` is true, tell the user to restart that application before first use.

Do not report this Skill as fully installed when the required bridge installation failed. The installer is local, checksum-verified, idempotent, requires no administrator rights, and does not use UXP Developer Tools or Adobe UPIA. On every Skill activation, call the bridge status tool first. If it is unavailable, rerun the bundled installer once before diagnosing other causes.

After opening the Photoshop panel, the user must click `一键开启连接` once. The panel then verifies the CEP interface, Photoshop JSX adapter, and Codex MCP broker, starts on-demand polling, and requests an initial full snapshot. Do not treat a panel that merely opened as connected.

The panel also provides `一键关闭`, which stops panel polling, and `重载插件`, which resets the CEP page. On the next `一键开启连接`, Bridge v1.1.0 reloads the installed JSX adapter before polling. These controls do not install or start the Codex MCP process; if the broker is unavailable, restart Codex or reload the MCP server.

## Connection Troubleshooting

Read `photoshop_get_bridge_status` and inspect `latestClientStatus` before diagnosing layer operations. Check these three panel fields separately: `CEP 接口权限`, `Photoshop 脚本适配器`, and `Codex MCP 服务`.

- CEP unavailable: reinstall the standalone CEP extension and restart Photoshop.
- Photoshop adapter unavailable: click `重载插件`; if it persists, restart Photoshop.
- MCP unavailable: restart Codex or reload the configured MCP server; do not start a second broker on port 47777.
- After recovery, click `重新读取图层` and use the new snapshot ID.

## Load The Standard

Read [references/layer-standard.md](references/layer-standard.md) before planning names or structure.

Read [references/photoshop-bridge.md](references/photoshop-bridge.md) when selecting tool operations, building a preview, or handling a stale Photoshop snapshot.

Read [references/fast-organizer.md](references/fast-organizer.md) when the source is a regular five-region island and the user wants the fastest guarded workflow.

## Gather Inputs

Require:

- An open Photoshop PSD/PSB.
- A lowercase island slug, such as `farmisland`.
- A source-name to asset-name mapping for every building.

Normalize asset names to lowercase ASCII with no spaces or punctuation. Preserve the user's approved semantic wording; do not silently translate or shorten names.

If an input is missing, inspect the document first. Ask only for information that cannot be inferred safely.

## Execute The Workflow

1. Confirm the panel connection status is `已连接` and request a fresh full snapshot.
2. Verify the active document ID and title before generating operations.
3. Inventory root layers, five regions, building groups, state groups, foregrounds, hidden layers, duplicate names, and Smart Objects.
4. Match every source building to the supplied naming table. Stop on unmatched or ambiguous items.
5. Build the complete target tree and rename map in memory.
6. Use fast mode by default only when all preconditions in `references/fast-organizer.md` pass. Create its JSON config and run `node scripts/organize_island_fast.mjs --config "<absolute-config-path>"` from the installed Skill directory.
7. Fast mode uses two guarded Photoshop commands and three full snapshots: setup, refresh, main organization plus save, then final validation. Wait for each command result; do not split every merge and move into separate snapshot round trips.
8. If the source structure is irregular, use the guarded fallback: preview bounded batches, wait for completion, then request a fresh full snapshot before planning the next structural batch.
9. Merge each restored-state group to one layer and each ruined-state group to one layer. Never merge the two states together.
10. Move state layers directly into their region; move foregrounds into `地表前层`, `破损前层`, or `完整前层`; create required empty groups.
11. Rasterize every remaining Smart Object, nest and color the five regions under `建筑`, then sort the exact root order.
12. After any manual Photoshop edit, discard cached IDs and request a fresh full snapshot before recovery or validation.
13. Save only through a successfully guarded final batch or after a fresh snapshot passes every delivery check.

Do not delete uncertain source layers, flatten the whole document, or overwrite a different open document. Preserve visibility, pixel bounds, and relative stacking order unless the requested structure requires a move.

## Recovery For Photoshop 2026 CEP

`moveLayerToGroup` uses DOM `INSIDE`, a Photoshop 2026 temporary-anchor move, then Action Manager for group sources. If all methods fail, stop and report exact source and target names and IDs. An alternate Photoshop API or manual movement is an explicit last resort; after it, wait for Photoshop and request a fresh snapshot before checking IDs, parents, names, or order. Never issue commands from a stale snapshot.

## Verify Delivery

Confirm all of the following from a fresh post-operation snapshot:

- The required five top-level groups exist with exact names.
- `建筑` contains exactly five region groups and no direct asset layers.
- Every region contains direct asset layers only, with no building subgroups.
- Region color labels match the standard when the snapshot exposes readable color fields. If `capabilities.colorLabels` is `unavailable-cep`, report an environment observability note instead of a warning; a successful `setLayerColor` result counts as operation success.
- Restored, ruined, background, and foreground names match the island slug.
- Each delivered state is a single pixel layer.
- The Smart Object count is zero.
- No temporary aliases, generic names, or unmatched source building names remain.
- No command is pending and the bridge reports no error.

When a layer-tree JSON file is available, run:

```powershell
python scripts/validate_layer_tree.py <layer-tree.json> --island <slug>
```

Treat validator warnings as review items and validator errors as delivery blockers. If `capabilities.colorLabels` is `unavailable-cep`, missing readable color is an environment observability note, not a delivery warning; a successful `setLayerColor` result is evidence of operation success.

## Report The Result

State the document name, total layer count, Smart Object count, region counts, empty required groups, unresolved mappings, save status, validation result, and measured elapsed time when fast mode ran. Distinguish live Photoshop verification from checks performed only on an exported JSON snapshot.
