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
| Delete an obsolete empty group | `deleteLayer` |

## Panel Connection Controls

After opening the CEP panel, click `一键开启连接`. It verifies the CEP interface, Photoshop JSX adapter, and the Codex MCP broker, then starts on-demand polling and requests a full snapshot.

`一键关闭` stops panel polling and invalidates in-flight work. `重载插件` resets the CEP page and is useful after an adapter script error. Neither button starts a second MCP broker; the broker is owned by the Codex MCP process on `127.0.0.1:47777`.

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

Prefer this dependency order:

1. Rename source state groups or layers where needed for unambiguous tracking.
2. Merge state groups.
3. Create required root and region groups.
4. Move final state layers and foregrounds.
5. Apply region color labels.
6. Remove obsolete empty groups.
7. Rasterize remaining Smart Objects.
8. Read a fresh tree and validate.

When a bridge supports aliases for newly created groups, use aliases inside a single atomic batch. Otherwise, create groups first, refresh the snapshot, and use their returned layer IDs in a second batch.

## Automatic Execution And Error Handling

- Preview mutations before queueing them.
- The bundled Bridge automatically executes only commands bound to its verified snapshot and active document.
- Apply small batches when merging or deleting because these operations are difficult to reverse after saving.
- After each structural batch, wait for completion and refresh the snapshot.
- In Photoshop 2026 CEP, a group-to-group move may require the temporary-anchor fallback; root sorting uses DOM `PLACEBEFORE` with Action Manager fallback and requires the same parent.
- After any manual move or sort, request a fresh snapshot before rebuilding or validating operations.
- Stop on the first failed operation. Do not continue with layer IDs whose parent structure may have changed.
- Save only after the final snapshot passes delivery checks.
