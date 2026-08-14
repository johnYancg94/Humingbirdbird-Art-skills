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

The panel also provides `一键关闭`, which stops panel polling, and `重载插件`, which safely resets the CEP page. These controls do not install or start the Codex MCP process; if the broker is unavailable, restart Codex or reload the MCP server.
## Connection Troubleshooting

Read `photoshop_get_bridge_status` and inspect `latestClientStatus` before diagnosing layer operations. Check these three panel fields separately: `CEP 接口权限`, `Photoshop 脚本适配器`, and `Codex MCP 服务`.

- CEP unavailable: reinstall the standalone CEP extension and restart Photoshop.
- Photoshop adapter unavailable: click `重载插件`; if it persists, restart Photoshop.
- MCP unavailable: restart Codex or reload the configured MCP server; do not start a second broker on port 47777.
- After recovery, click `重新读取图层` and use the new snapshot ID.

## Load The Standard

Read [references/layer-standard.md](references/layer-standard.md) before planning names or structure.

Read [references/photoshop-bridge.md](references/photoshop-bridge.md) when selecting tool operations, building a preview, or handling a stale Photoshop snapshot.

## Gather Inputs

Require:

- An open Photoshop PSD/PSB.
- A lowercase island slug, such as `farmisland`.
- A source-name to asset-name mapping for every building.

Normalize asset names to lowercase ASCII with no spaces or punctuation. Preserve the user's approved semantic wording; do not silently translate or shorten names.

If an input is missing, inspect the document first. Ask only for information that cannot be inferred safely.

## Execute The Workflow

1. Confirm the panel connection status is `已连接`; if it is `已关闭`, ask the user to click `一键开启连接`.
2. Read the active document title, current layer snapshot, and bridge status.
3. Inventory all top-level groups, building groups, state groups, foreground layers, duplicate names, hidden layers, and Smart Objects.
4. Match source buildings to the supplied naming table. Report unmatched or ambiguous items before changing them.
5. Build the complete target tree and rename map in memory.
6. Preview every operation against the same snapshot and document identity.
7. Apply changes in bounded batches. The bundled Bridge executes Agent commands automatically after snapshot, document, and per-operation preview guards pass; wait for each command result before continuing. After every structural command, request a fresh full snapshot before planning the next batch. Never continue from cached IDs after a manual Photoshop edit.
8. Merge each restored-state group to one layer and each ruined-state group to one layer. Do not merge restored and ruined states together.
9. Move building layers directly into one of the five region groups. Remove obsolete per-building child groups only after their contents are safely represented.
10. Move foregrounds into `地表前层`, `破损前层`, or `完整前层`. Create any missing required group even when it remains empty.
11. Rasterize every Smart Object after naming and placement are final.
12. Re-read a fresh snapshot, run all delivery checks, and save the document.

Do not delete uncertain source layers, flatten the whole document, or overwrite a different open document. Preserve visibility, pixel bounds, and relative stacking order unless the requested structure requires a move.

## Recovery For Photoshop 2026 CEP

moveLayerToGroup includes an Action Manager fallback for group sources. If both methods fail, stop and report exact source and target names and IDs. Manual movement or root sorting is an explicit last resort; after it, wait for Photoshop and request a fresh snapshot before checking IDs, parents, names, or order. Never issue commands from a stale snapshot.

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

State the document name, total layer count, Smart Object count, region counts, empty required groups, unresolved mappings, save status, and validation result. Distinguish live Photoshop verification from checks performed only on an exported JSON snapshot.
