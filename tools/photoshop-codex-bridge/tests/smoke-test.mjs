import { spawn } from "node:child_process";
import { createServer } from "node:net";

async function getFreePort() {
  if (process.env.PS_BRIDGE_SMOKE_PORT) return process.env.PS_BRIDGE_SMOKE_PORT;
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = String(address.port);
      server.close(() => resolve(port));
    });
  });
}

const smokePort = await getFreePort();

const server = spawn(process.execPath, ["mcp-server/server.mjs"], {
  cwd: new URL("../", import.meta.url),
  stdio: ["pipe", "pipe", "inherit"],
  env: {
    ...process.env,
    PS_BRIDGE_PORT: smokePort
  }
});

let rpcOutput = "";
server.stdout.on("data", chunk => {
  rpcOutput += chunk;
});

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${smokePort}${path}`, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${path}`);
  }
  return response.json();
}

function rpc(id, method, params = {}) {
  server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
}

try {
  await wait(250);

  await request("/photoshop/snapshot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      document: { id: 99, title: "smoke-test.psd" },
      layers: [
        {
          id: 10,
          parentId: null,
          index: 0,
          depth: 0,
          name: "Group",
          isGroup: true,
          layers: [
            {
              id: 11,
              parentId: 10,
              index: 0,
              depth: 1,
              name: "Nested Layer",
              isGroup: false,
              descriptor: {
                ok: true,
                layerKind: 1,
                mode: "normal"
              }
            }
          ]
        },
        {
          id: 1,
          parentId: null,
          index: 1,
          depth: 0,
          name: "Layer 1",
          isGroup: false,
          descriptor: {
            ok: true,
            layerKind: 1,
            mode: "normal"
          }
        },
        {
          id: 20,
          parentId: null,
          index: 2,
          depth: 0,
          name: "人物_head",
          isGroup: false
        },
        {
          id: 21,
          parentId: null,
          index: 3,
          depth: 0,
          name: "人物_body",
          isGroup: false
        }
      ]
    })
  });

  await request("/photoshop/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ok: true,
      photoshopVersion: "smoke",
      hasDocument: true,
      documentTitle: "smoke-test.psd",
      polling: true
    })
  });

  const health = await request("/health");
  if (health.photoshop.latestClientStatus.photoshopVersion !== "smoke") {
    throw new Error("Photoshop client status was not recorded");
  }
  const initialTree = await request("/codex/layer-tree");
  if (!initialTree.connected || initialTree.layerCount !== 5) {
    throw new Error("HTTP layer tree did not return the latest snapshot");
  }
  if (initialTree.snapshot.layers[1].descriptor.mode !== "normal") {
    throw new Error("HTTP layer tree did not preserve descriptor summaries");
  }
  const initialSummary = await request("/codex/layer-state-summary");
  if (initialSummary.layerState.totalLayers !== 5 || initialSummary.layerState.groups !== 1 || initialSummary.layerState.leafLayers !== 4) {
    throw new Error("Layer state summary did not count groups and leaf layers");
  }
  if (initialSummary.layerState.descriptor.ok !== 2 || initialSummary.layerState.descriptor.missing !== 3) {
    throw new Error("Layer state summary did not count descriptor coverage");
  }

  const httpPreview = await request("/codex/layer-operations/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operations: [{ op: "renameLayer", layerId: 1, name: "001_Background" }]
    })
  });
  if (httpPreview.preview[0].from !== "Layer 1") {
    throw new Error("HTTP preview did not validate against the latest layer snapshot");
  }
  if (!httpPreview.snapshotId || httpPreview.document.id !== 99) {
    throw new Error("HTTP preview did not expose snapshot identity");
  }
  const nestedPreview = await request("/codex/layer-operations/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operations: [{ op: "createGroup", name: "Child Group", parentLayerId: 10 }]
    })
  });
  if (nestedPreview.preview[0].parentLayerId !== 10) {
    throw new Error("createGroup parentLayerId was not preserved in preview");
  }
  const aliasPreview = await request("/codex/layer-operations/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operations: [
        { op: "createGroup", name: "Generated Group", assignAlias: "generated" },
        { op: "moveLayerToGroup", layerId: 1, groupAlias: "generated" }
      ]
    })
  });
  if (aliasPreview.preview[0].assignAlias !== "generated" || aliasPreview.preview[1].groupAlias !== "generated") {
    throw new Error("Alias-based create-and-move plan was not preserved in preview");
  }

  const renamePlan = await request("/codex/rename-plans/tree-order", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prefix: "PS_",
      startAt: 1,
      pad: 2,
      includeGroups: false
    })
  });
  if (renamePlan.operations.length !== 4 || renamePlan.operations[0].name !== "PS_01_Nested Layer") {
    throw new Error("Tree-order rename plan did not follow the current layer tree order");
  }

  const queuedRenamePlan = await request("/codex/rename-plans/tree-order", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prefix: "Queued_",
      includeGroups: false,
      queue: true
    })
  });
  if (!queuedRenamePlan.queued?.command?.expectedSnapshotId) {
    throw new Error("Queued tree-order rename plan was not bound to a snapshot");
  }
  const queuedThenCancelled = await request("/codex/layer-operations/queue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operations: [{ op: "renameLayer", layerId: 1, name: "Cancelled_Name" }],
      reason: "smoke cancel", expectedSnapshotId:queuedRenamePlan.queued.command.expectedSnapshotId, expectedDocumentId:99, expectedDocumentTitle:"smoke-test.psd"
    })
  });
  const cancelled = await request(`/codex/commands/${queuedThenCancelled.command.id}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: "smoke test cancellation" })
  });
  if (cancelled.command.status !== "cancelled") {
    throw new Error("Queued command was not cancelled");
  }
  const groupingPlan = await request("/codex/grouping-plans/prefix", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      delimiter: "_",
      minGroupSize: 2,
      groupNamePrefix: "组_"
    })
  });
  if (groupingPlan.groups[0].name !== "组_人物" || groupingPlan.operations.length !== 3) {
    throw new Error("Prefix grouping plan did not create the expected group-and-move operations");
  }
  const queuedGroupingPlan = await request("/codex/grouping-plans/prefix", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      delimiter: "_",
      minGroupSize: 2,
      queue: true
    })
  });
  if (!queuedGroupingPlan.queued?.command?.preview[1].groupAlias) {
    throw new Error("Queued prefix grouping plan did not preserve alias-based move preview");
  }

  rpc(1, "tools/call", {
    name: "photoshop_get_bridge_status",
    arguments: {}
  });

  rpc(2, "tools/call", {
    name: "photoshop_get_layer_tree",
    arguments: { refresh: false }
  });

  rpc(9, "tools/call", {
    name: "photoshop_get_layer_state_summary",
    arguments: {}
  });

  rpc(3, "tools/call", {
    name: "photoshop_preview_layer_operations",
    arguments: {
      operations: [
        { op: "renameLayer", layerId: 1, name: "001_Background" },
        { op: "moveLayerToGroup", layerId: 1, groupLayerId: 10 }
      ]
    }
  });

  rpc(4, "tools/call", {
    name: "photoshop_preview_layer_operations",
    arguments: {
      operations: [
        { op: "moveLayerToGroup", layerId: 10, groupLayerId: 1 }
      ]
    }
  });

  rpc(5, "tools/call", {
    name: "photoshop_preview_layer_operations",
    arguments: {
      operations: [
        { op: "createGroup", name: "Invalid Child Group", parentLayerId: 1 }
      ]
    }
  });

  const queuePreview = await request("/codex/layer-operations/preview", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operations:[{op:"renameLayer",layerId:1,name:"001_Background"}]})});
  rpc(6, "tools/call", {
    name: "photoshop_queue_layer_operations",
    arguments: {
      operations: [
        { op: "renameLayer", layerId: 1, name: "001_Background" },
        { op: "moveLayerToGroup", layerId: 1, groupLayerId: 10 }
      ],
      reason: "smoke test",
      expectedSnapshotId:queuePreview.snapshotId,expectedDocumentId:99,expectedDocumentTitle:"smoke-test.psd"
    }
  });

  await wait(150);
  const next = await request("/photoshop/commands/next");
  if (!next.command || next.command.payload.operations[0].name !== "Queued_001_Nested Layer") {
    throw new Error("Queued rename plan was not available to Photoshop poller first");
  }
  await request(`/photoshop/commands/${next.command.id}/result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ok: true,
      results: [{ ok: true, op: "renameLayer", layerId: 11 }]
    })
  });

  const nextGrouping = await request("/photoshop/commands/next");
  if (!nextGrouping.command || nextGrouping.command.payload.operations[0].op !== "createGroup") {
    throw new Error("Queued grouping plan was not available to Photoshop poller");
  }
  await request(`/photoshop/commands/${nextGrouping.command.id}/result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ok: true,
      results: [
        { ok: true, op: "createGroup", layerId: 30, assignAlias: "group_人物" },
        { ok: true, op: "moveLayerToGroup", layerId: 20, groupLayerId: 30 },
        { ok: true, op: "moveLayerToGroup", layerId: 21, groupLayerId: 30 }
      ]
    })
  });

  const nextExplicit = await request("/photoshop/commands/next");
  if (!nextExplicit.command || nextExplicit.command.payload.operations[0].name !== "001_Background") {
    throw new Error("Queued command was not available to Photoshop poller");
  }
  if (!nextExplicit.command.payload.expectedSnapshotId || nextExplicit.command.payload.expectedDocumentId !== 99) {
    throw new Error("Queued command was not bound to the latest snapshot and document");
  }
  if (nextExplicit.command.payload.preview[0].from !== "Layer 1" || nextExplicit.command.payload.preview[1].groupName !== "Group") {
    throw new Error("Queued command did not include per-operation expected state");
  }

  await request(`/photoshop/commands/${nextExplicit.command.id}/result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ok: true,
      results: [
        { ok: true, op: "renameLayer", layerId: 1 },
        { ok: true, op: "moveLayerToGroup", layerId: 1, groupLayerId: 10 }
      ]
    })
  });

  await request("/photoshop/snapshot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      document: { id: 99, title: "smoke-test.psd" },
      layers: [
        {
          id: 10,
          parentId: null,
          index: 0,
          depth: 0,
          name: "Group",
          isGroup: true,
          layers: [
            {
              id: 11,
              parentId: 10,
              index: 0,
              depth: 1,
              name: "Queued_001_Nested Layer",
              isGroup: false
            }
          ]
        },
        { id: 1, parentId: null, index: 1, depth: 0, name: "001_Background", isGroup: false }
      ]
    })
  });
  const afterTree = await request("/codex/layer-tree");
  if (afterTree.snapshot.layers[1].name !== "001_Background") {
    throw new Error("HTTP layer tree did not expose the after-command snapshot");
  }
  const afterSummary = await request("/codex/layer-state-summary");
  if (afterSummary.layerState.totalLayers !== 3 || afterSummary.layerState.groups !== 1 || afterSummary.layerState.descriptor.missing !== 3) {
    throw new Error("Layer state summary did not update after the latest snapshot");
  }
  const snapshots = await request("/codex/snapshots");
  if (snapshots.snapshots.length < 2) {
    throw new Error("Snapshot history did not retain multiple snapshots");
  }
  const latestDiff = await request("/codex/layer-diff/latest");
  if (!latestDiff.diff.available) {
    throw new Error("Latest layer diff was not available after multiple snapshots");
  }
  if (!latestDiff.diff.changed.some(change => change.id === 1 && change.changes.name?.to === "001_Background")) {
    throw new Error("Latest layer diff did not include the layer rename");
  }
  if (!latestDiff.diff.removed.some(layer => layer.id === 20 || layer.id === 21)) {
    throw new Error("Latest layer diff did not include removed layers");
  }

  const commandStatus = await request(`/codex/commands/${nextExplicit.command.id}`);
  if (commandStatus.command.status !== "completed") {
    throw new Error("Completed command status was not retained");
  }
  const cancelDeliveredResponse = await fetch(`http://127.0.0.1:${smokePort}/codex/commands/${nextExplicit.command.id}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: "too late" })
  });
  if (cancelDeliveredResponse.ok) {
    throw new Error("Completed command should not be cancellable");
  }

  rpc(7, "tools/call", {
    name: "photoshop_get_command_results",
    arguments: {}
  });
  rpc(8, "tools/call", {
    name: "photoshop_get_latest_layer_diff",
    arguments: {}
  });

  await wait(250);

  if (!rpcOutput.includes("smoke-test.psd")) {
    throw new Error("Layer tree snapshot was not returned through MCP");
  }
  if (!rpcOutput.includes("renameLayer")) {
    throw new Error("Command result was not returned through MCP");
  }
  if (!rpcOutput.includes("is not a group")) {
    throw new Error("Invalid group operation was not rejected");
  }

  console.log("smoke test passed");
} finally {
  server.kill();
}
