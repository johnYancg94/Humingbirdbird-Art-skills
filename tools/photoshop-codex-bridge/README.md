# Photoshop Codex Bridge

Windows bridge for letting Codex inspect and organize Photoshop 2026 layer state.

## Install

Use the packaged Windows release:

1. Close Photoshop and start no new Codex tasks during installation.
2. Double-click `Install.bat`.
3. Restart Photoshop and Codex.
4. In Photoshop, open **Window > Extensions (Legacy) > Photoshop Codex Bridge**.
5. Start a new Codex task and ask it to read the current Photoshop layer tree.

The installer places a private Node runtime and bridge under the current user's
Local AppData folder, installs the CEP extension in the current user's Adobe
extensions folder, backs up the existing Codex configuration, and registers the
MCP server. It requires neither UXP Developer Tools nor Adobe UPIA. The release
includes `Manual-Install.txt` as a fallback.

Use the Start menu entry **Uninstall Photoshop Codex Bridge** to remove the
release and restore the Codex MCP section that existed before installation.

## Architecture

```text
Codex
  -> MCP tools over stdio
  -> mcp-server/server.mjs
  -> local HTTP broker on 127.0.0.1:47777
  -> Photoshop CEP extension polls broker
  -> Photoshop document/layers
```

The MCP server has two roles:

- It exposes tools Codex can call.
- It hosts a local HTTP broker that the Photoshop CEP panel can poll.

This avoids requiring Codex to inject code into Photoshop. Photoshop stays in control of its own document APIs, while Codex only submits explicit commands through a local, auditable queue.

## MCP Tools

- `photoshop_get_bridge_status`: returns broker status, Photoshop listener status, snapshot freshness, and recent command lifecycle.
- `photoshop_get_layer_tree`: requests a fresh layer snapshot from Photoshop. It loads through depth 1 by default; use `maxDepth: 0` for top-level only or `full: true` only when the complete tree is required.
- `photoshop_get_layer_state_summary`: returns layer-state coverage counts for the latest snapshot, including total layers, groups, leaf layers, and descriptor ok/failed/missing counts.
- `photoshop_get_snapshot_history`: returns summaries of recent snapshots received from Photoshop.
- `photoshop_get_latest_layer_diff`: returns changes between the two most recent layer snapshots.
- `photoshop_preview_layer_operations`: validates and previews layer operations against the latest snapshot.
- `photoshop_queue_layer_operations`: queues rename, visibility, and group-create operations for Photoshop to execute.
- `photoshop_build_tree_order_rename_plan`: builds a deterministic tree-order numbering plan and can optionally queue it.
- `photoshop_build_prefix_grouping_plan`: groups layers by name prefix, creating groups and moves with aliases, and can optionally queue it.
- `photoshop_get_command_results`: returns completed command results from Photoshop.
- `photoshop_cancel_pending_command`: cancels a queued command before Photoshop has received it.

## Supported Operations

The protocol currently accepts:

- `renameLayer`: rename a layer by numeric Photoshop layer ID.
- `setVisibility`: show or hide a layer by ID.
- `createGroup`: create a new layer group.
- `moveLayerToGroup`: move a layer into an existing group layer, with a Photoshop 2026 anchor fallback for group sources.
- `moveLayerBefore`: reorder sibling layers or root groups before a reference layer.
- `mergeGroupToLayer`: merge a group into one final pixel layer.
- `deleteLayer`: delete an explicitly targeted obsolete layer or empty group.
- `setLayerColor`: set a Photoshop layer color label.
- `rasterizeLayer`: rasterize a Smart Object layer.
- `saveDocument`: save the active document after a guarded batch completes.

The MCP server validates operations against the latest snapshot before queueing. This catches missing layer IDs, attempts to move into a non-group layer, empty names, and invalid booleans before Photoshop receives the command.

A single command may safely chain operations against the same layer, such as merge, rename, move, color-label, reorder, and save. Preview checks remain strict for untouched layers, while layers already mutated earlier in the same guarded batch are validated against the live result instead of a stale pre-batch name. This reduces large organization jobs from many snapshot round trips to a small number of deterministic batches.

Layer snapshots include `parentId`, `index`, `depth`, `path`, and `childCount` so Codex can build deterministic organization and renaming plans. The CEP extension uses one Photoshop Action Manager `multiGet` request for compact layer descriptors instead of traversing the much slower DOM collections or requesting each full descriptor separately, then trims the hierarchy to the requested depth in memory. A conservative DOM fallback remains available for older Photoshop builds. `createGroup` accepts `parentLayerId`; when provided, it must point at an existing group layer.

The built-in tree-order rename planner supports conservative numbered names such as `PS_001_Original Name`. It is intended as a safe baseline organizer; more specific user requests can still be converted into explicit `renameLayer`, `createGroup`, and `moveLayerToGroup` operations after Codex reads the full tree.

Within one queued command, `createGroup` can include `assignAlias`, and later `moveLayerToGroup` operations can refer to that new group with `groupAlias`. This supports plans like "create a new group, then move these layers into it" even though Photoshop has not assigned the new group ID before execution.

The prefix grouping planner uses that alias mechanism to support conservative organization such as grouping `人物_head` and `人物_body` into a new `人物` group. It only groups prefixes with at least `minGroupSize` matches.

Commands move through `queued`, `delivered`, then `completed` or `failed`. Use `photoshop_get_bridge_status` to see whether Photoshop has polled the command yet.

Queued commands can be cancelled before delivery. Once Photoshop receives a command, the panel validates and executes it automatically.

Queued write commands are bound to the latest `snapshotId` and Photoshop document identity. The Photoshop panel checks the active document before executing a command so stale commands are rejected instead of being applied to the wrong PSD.

Each queued command also carries a per-operation preview. Before editing, the Photoshop panel rechecks the current layer name, visibility, and target group identity where applicable. If the PSD changed since the preview, the command fails instead of applying to stale layer state.

The Photoshop panel runs in Agent automatic-control mode. Commands require a matching snapshot ID, Photoshop document identity, and one preview entry per operation. The JSX adapter then rechecks the active document and current layer state before applying any operation. A mismatch fails the command without editing the PSD.

## Safety Model

The bridge is local-only by default. It binds to `127.0.0.1` and expects Photoshop to poll from the same machine.

Layer-modifying operations are queued as structured JSON and automatically executed only after the panel and JSX adapter pass their guards. The broker binds to localhost, so remote hosts cannot submit commands through the default configuration.

## Development

From this directory:

```powershell
node .\mcp-server\server.mjs
```

For local Codex plugin development, install this folder as a local plugin or add it to a local marketplace. The included `.mcp.json` points at the bundled server.

This workspace also includes a project-scoped Codex MCP config at `../.codex/config.toml`. In a trusted Codex project, a new thread can load the `photoshop_codex_bridge` MCP server from that config.

## Photoshop CEP

The release installer copies `photoshop-cep` to the current user's CEP extension
directory. After restarting Photoshop, open **Window > Extensions (Legacy) >
Photoshop Codex Bridge** and click `一键开启连接`. The panel verifies the CEP interface,
the Photoshop JSX adapter, and the Codex MCP broker before it reports `已连接`. It does
not scan layers while closed. A snapshot is generated when Codex calls
`photoshop_get_layer_tree` or the user clicks `重新读取图层`. Use `一键关闭` to stop
polling and reject stale asynchronous work, or `重载插件` to reset the panel. Layer-modifying
commands execute automatically when their snapshot, document, and operation previews still match.

Always verify write workflows against a duplicate PSD before using them on production artwork.

## Photoshop 2026 Runtime Check

1. Start a new Codex thread in this workspace so `.codex/config.toml` is loaded.
2. Install the CEP extension with the release `Install.bat`.
3. Open a duplicate PSD in Photoshop 2026.
4. Open **Window > Extensions (Legacy) > Photoshop Codex Bridge** and click `一键开启连接`. Confirm the panel shows `已连接` and all three connection checks are available.
5. Run the read-only runtime verifier:

```powershell
node .\scripts\wait-for-photoshop-runtime.mjs --timeout-ms 120000
```

6. Ask Codex to call `photoshop_get_layer_tree`.
7. Pick one safe test layer ID in the duplicate PSD.
8. Run the write verifier against that duplicate PSD:

```powershell
node .\scripts\wait-for-photoshop-runtime.mjs --timeout-ms 120000 --rename-layer-id 123 --rename-to Codex_Runtime_Rename_Test
```

9. The Agent command executes automatically after the safety guards pass.
10. Check the verifier report, `photoshop_get_command_results`, and the PSD layer panel.

When `--rename-layer-id` and `--rename-to` are provided, the verifier waits for both the command result and a fresh layer snapshot where that layer ID has the requested new name.

If Codex cannot see Photoshop, call `photoshop_get_bridge_status` first. The panel must show `已连接`; inspect `CEP 接口权限`, `Photoshop 脚本适配器`, and `Codex MCP 服务` separately. If MCP is unavailable, restart Codex or reload the MCP server. `snapshotAgeMs` appears after the first on-demand layer read.

## Verification

Run the local bridge tests without Photoshop:

```powershell
node .\tests\smoke-test.mjs
```

Or run the full local check wrapper from the workspace root:

```powershell
.\photoshop-codex-bridge\scripts\run-local-checks.ps1
```

The local check wrapper also tests synthetic runtime reports for read, rename, grouping, and timeout validation paths.

Run only the bridge configuration preflight:

```powershell
node .\photoshop-codex-bridge\scripts\check-bridge-config.mjs
```

Diagnose the current bridge/Photoshop connection state:

```powershell
.\photoshop-codex-bridge\scripts\diagnose-bridge.ps1
```

Watch for Photoshop to become ready, then run the duplicate-PSD runtime proof automatically:

```powershell
.\photoshop-codex-bridge\scripts\watch-photoshop-runtime.ps1 -RunRuntimeCheck -RequireDescriptors -RequireRealtime
```

Run the runtime verifier in expected-timeout mode when Photoshop is not open:

```powershell
node .\scripts\wait-for-photoshop-runtime.mjs --timeout-ms 500 --expect-timeout
```

This proves the Codex/MCP/broker protocol. It does not prove Photoshop runtime behavior. For that, open the CEP panel in Photoshop 2026, then use Codex to call `photoshop_get_layer_tree` and queue a small rename against a duplicate PSD.

For Photoshop runtime checks, use the wrapper from the workspace root:

```powershell
.\photoshop-codex-bridge\scripts\run-photoshop-runtime-check.ps1
```

The wrapper validates the generated report automatically. Use `-SkipReportValidation` only when debugging a partial report.
Use `-RequireDescriptors` when you want the report validator to require every reported layer to include tree-position fields and a Photoshop descriptor object. Descriptor reads are best-effort; a layer-level descriptor error is acceptable evidence as long as it is recorded in the snapshot.
Runtime reports also include `layerStateSummary`, which is the quick audit view for whether every layer in the final snapshot had descriptor evidence.
Use `-RequireRealtime` to require two distinct fresh snapshots from the Photoshop panel before the report is accepted as runtime evidence.

For a write check against a duplicate PSD:

```powershell
.\photoshop-codex-bridge\scripts\run-photoshop-runtime-check.ps1 -RenameLayerId 123 -RenameTo Codex_Runtime_Rename_Test
```

Or let the verifier choose the first non-group layer automatically:

```powershell
.\photoshop-codex-bridge\scripts\run-photoshop-runtime-check.ps1 -RenameFirstLayer
```

For a grouping check against a duplicate PSD whose layer names share prefixes such as `人物_head` and `人物_body`:

```powershell
.\photoshop-codex-bridge\scripts\run-photoshop-runtime-check.ps1 -GroupPrefixDelimiter "_" -GroupMinSize 2
```

Or let the verifier create a temporary runtime group and move the first two non-group layers into it:

```powershell
.\photoshop-codex-bridge\scripts\run-photoshop-runtime-check.ps1 -GroupFirstLayers 2
```

Validate a saved runtime report:

```powershell
node .\photoshop-codex-bridge\scripts\validate-runtime-report.mjs --report .\.codex-tmp\photoshop-runtime-report.json
```

Require write evidence:

```powershell
node .\photoshop-codex-bridge\scripts\validate-runtime-report.mjs --report .\.codex-tmp\photoshop-runtime-report.json --require-rename
node .\photoshop-codex-bridge\scripts\validate-runtime-report.mjs --report .\.codex-tmp\photoshop-runtime-report.json --require-grouping
node .\photoshop-codex-bridge\scripts\validate-runtime-report.mjs --report .\.codex-tmp\photoshop-runtime-report.json --require-descriptors
node .\photoshop-codex-bridge\scripts\validate-runtime-report.mjs --report .\.codex-tmp\photoshop-runtime-report.json --require-realtime
```

Run the completion audit after collecting a real Photoshop 2026 report:

```powershell
.\photoshop-codex-bridge\scripts\audit-completion.ps1 -RuntimeReport .\.codex-tmp\photoshop-runtime-report.json -RequireRename -RequireGrouping -RequireDescriptors -RequireRealtime
```

The most direct duplicate-PSD runtime proof is:

```powershell
.\photoshop-codex-bridge\scripts\run-photoshop-runtime-check.ps1 -RenameFirstLayer -GroupFirstLayers 2 -RequireDescriptors -RequireRealtime
```

For local-only readiness without claiming the full Photoshop runtime goal:

```powershell
.\photoshop-codex-bridge\scripts\audit-completion.ps1 -LocalOnly
```

## 1.2.0 queue contract

Explicit HTTP and MCP queue calls require `expectedSnapshotId`, `expectedDocumentId`, and `expectedDocumentTitle` from the inspected snapshot/preview. Missing or stale identities reject the request. Previewing does not grant permission to silently adopt a different document.

The island organizer validates a fresh final snapshot before a separate `saveDocument` command. Use the canonical skill scripts in `../../organize-photoshop-island-layers`; `scripts/organize-island-fast.mjs` is a source-checkout wrapper. Run portable offline regression with `node scripts/run-tests.mjs`.

CEP failures return zero-based `failedOperationIndex`, `failedOperation`, `completedCount` and completed `results`. A timeout does not cancel execution; query the recorded command ID before recovery. Refresh before planning any continuation.
