# Photoshop Layer-Control Contract

Use any Photoshop integration that can read a complete active-document layer tree and perform equivalent operations. A compatible bridge should expose these capabilities:

| Capability | Typical operation |
| --- | --- |
| Read active layer tree | `photoshop_get_layer_tree` |
| Read bridge health | `photoshop_get_bridge_status` |
| Preview changes | `photoshop_preview_layer_operations` |
| Queue approved changes | `photoshop_queue_layer_operations` |
| Rename a layer | `renameLayer` |
| Create a group | `createGroup` |
| Move a layer into a group | `moveLayerToGroup` (DOM, temporary anchor, then Action Manager for groups) |
| Reorder same-parent layers | `moveLayerBefore` |
| Merge a group to one layer | `mergeGroupToLayer` |
| Set a region color label | `setLayerColor` |
| Rasterize a Smart Object | `rasterizeLayer` |
| Save the guarded result | `saveDocument` |
| Delete an obsolete empty group | `deleteLayer` |

## Panel Connection Controls

After opening the CEP panel, click `一键开启连接`. It verifies the CEP interface, Photoshop JSX adapter, and the Codex MCP broker, then starts on-demand polling and requests a full snapshot.

`一键关闭` stops panel polling and invalidates in-flight work. `重载插件` resets the CEP page. The next `一键开启连接` reloads the installed JSX adapter before polling, so Bridge updates can take effect without retaining stale JSX. Neither button starts a second MCP broker; the broker is owned by the Codex MCP process on `127.0.0.1:47777`.

Use the panel status fields to distinguish:
- `CEP 接口权限`
- `Photoshop 脚本适配器`
- `Codex MCP 服务`

If the MCP service is unavailable, restart Codex or reload the MCP server. After any recovery, click `重新读取图层` and rebuild operations from the new snapshot.

## Snapshot Safety

Bind every preview and queued batch to:

- The current snapshot ID.
- The active Photoshop document ID.
- The active document title.

If any identity changes or the snapshot becomes stale, stop, read a fresh tree, and rebuild the remaining plan. Never reuse layer IDs from another snapshot or document.

## Operation Order

For a regular five-region source, use `scripts/organize_island_fast.mjs` and the preconditions in `references/fast-organizer.md`. It intentionally uses two commands:

1. Setup: rename surface foregrounds, create required roots, and collect background sources.
2. Main: merge, rename, move, delete obsolete groups, color regions, reorder roots, and save.

Request a fresh full snapshot before setup, between the two commands, and after the main command. Within a guarded command, v1.1.0 permits a later operation to use the live result of an earlier rename, merge, or move while preserving stale-state checks for untouched layers.

For irregular sources, use dependency-ordered fallback batches: rename, merge, create targets, move, color, delete obsolete groups, rasterize, refresh, validate, then save.

## Automatic Execution And Error Handling

- Preview mutations before queueing them.
- The bundled Bridge automatically executes only commands bound to its verified snapshot and active document.
- Use the tested fast planner for regular sources. Use smaller merge or delete batches only for irregular fallback recovery.
- After each structural batch, wait for completion and refresh the snapshot.
- In Photoshop 2026 CEP, a group-to-group move may require the temporary-anchor fallback; root sorting uses DOM `PLACEBEFORE` with Action Manager fallback and requires the same parent.
- After any manual move or sort, request a fresh snapshot before rebuilding or validating operations.
- Stop on the first failed operation. Do not continue with layer IDs whose parent structure may have changed.
- Save only after the final snapshot passes delivery checks.
