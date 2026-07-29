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
| Move a layer into a group | `moveLayerToGroup` |
| Merge a group to one layer | `mergeGroupToLayer` |
| Set a region color label | `setLayerColor` |
| Rasterize a Smart Object | `rasterizeLayer` |
| Delete an obsolete empty group | `deleteLayer` |

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

## Approval And Error Handling

- Preview mutations before queueing them.
- Keep automatic application off by default.
- Apply small batches when merging or deleting because these operations are difficult to reverse after saving.
- After each structural batch, wait for completion and refresh the snapshot.
- Stop on the first failed operation. Do not continue with layer IDs whose parent structure may have changed.
- Save only after the final snapshot passes delivery checks.
