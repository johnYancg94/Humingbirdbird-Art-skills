import {snapshotGuard} from "../mcp-server/snapshot-guard.mjs";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) continue;
  const key = arg.slice(2);
  const next = process.argv[i + 1];
  if (next && !next.startsWith("--")) {
    args.set(key, next);
    i += 1;
  } else {
    args.set(key, true);
  }
}

const host = args.get("host") || "127.0.0.1";
const port = Number(args.get("port") || process.env.PS_BRIDGE_PORT || "47777");
const timeoutMs = Number(args.get("timeout-ms") || "120000");
const minLayerCount = Number(args.get("min-layer-count") || "1");
const maxSnapshotAgeMs = Number(args.get("max-snapshot-age-ms") || "10000");
const outPath = resolve(args.get("out") || ".codex-tmp/photoshop-runtime-report.json");
const expectTimeout = Boolean(args.get("expect-timeout"));
const renameLayerId = args.has("rename-layer-id") ? Number(args.get("rename-layer-id")) : null;
const renameTo = args.get("rename-to") || null;
const renameFirstLayer = Boolean(args.get("rename-first-layer"));
const renamePrefix = args.get("rename-prefix") || "Codex_Runtime_Rename_Test";
const commandTimeoutMs = Number(args.get("command-timeout-ms") || "60000");
const groupPrefixDelimiter = args.get("group-prefix-delimiter") || null;
const groupMinSize = args.has("group-min-size") ? Number(args.get("group-min-size")) : 2;
const groupNamePrefix = args.get("group-name-prefix") || "";
const groupFirstLayers = args.has("group-first-layers") ? Number(args.get("group-first-layers")) : null;
const explicitGroupName = args.get("group-name") || "Codex_Runtime_Group_Test";
const requireRealtime = Boolean(args.get("require-realtime"));
const realtimeWindowMs = Number(args.get("realtime-window-ms") || "15000");

let serverProcess = null;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function requestHealth() {
  const response = await fetch(`http://${host}:${port}/health`);
  if (!response.ok) {
    throw new Error(`Bridge health returned HTTP ${response.status}`);
  }
  return response.json();
}

async function requestJson(path, options = {}) {
  const response = await fetch(`http://${host}:${port}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || `HTTP ${response.status} for ${path}`);
  }
  return body;
}

async function ensureBroker() {
  try {
    await requestHealth();
    return { started: false };
  } catch (_) {
    serverProcess = spawn(process.execPath, ["mcp-server/server.mjs"], {
      cwd: new URL("../", import.meta.url),
      stdio: ["ignore", "ignore", "inherit"],
      env: {
        ...process.env,
        PS_BRIDGE_HOST: host,
        PS_BRIDGE_PORT: String(port)
      }
    });
    await wait(400);
    await requestHealth();
    return { started: true, pid: serverProcess.pid };
  }
}

function isReady(status) {
  const clientStatus = status?.photoshop?.latestClientStatus;
  return Boolean(
    status?.photoshop?.hasSnapshot &&
    Number(status?.photoshop?.snapshotAgeMs ?? Number.POSITIVE_INFINITY) <= maxSnapshotAgeMs &&
    clientStatus?.polling &&
    clientStatus?.hasDocument &&
    clientStatus?.photoshopVersion &&
    clientStatus.photoshopVersion !== "smoke" &&
    clientStatus.documentTitle !== "smoke-test.psd" &&
    Number(clientStatus?.layerCount || 0) >= minLayerCount
  );
}

function findLayerById(layers, layerId) {
  for (const layer of layers || []) {
    if (layer.id === layerId) return layer;
    const child = findLayerById(layer.layers || [], layerId);
    if (child) return child;
  }
  return null;
}

function flattenLayers(layers, flat = []) {
  for (const layer of layers || []) {
    flat.push(layer);
    flattenLayers(layer.layers || [], flat);
  }
  return flat;
}

function renameTargetFromTree(tree) {
  const layers = flattenLayers(tree?.snapshot?.layers || [])
    .filter(layer => typeof layer.id === "number" && !layer.isGroup);
  if (!layers.length) {
    throw new Error("--rename-first-layer could not find a non-group layer in the latest snapshot");
  }
  const layer = layers[0];
  return {
    layerId: layer.id,
    name: `${renamePrefix}_${Date.now()}`
  };
}

function groupTargetsFromTree(tree) {
  if (groupFirstLayers === null) return null;
  if (!Number.isInteger(groupFirstLayers) || groupFirstLayers < 1) {
    throw new Error("--group-first-layers must be a positive integer");
  }
  const layers = flattenLayers(tree?.snapshot?.layers || [])
    .filter(layer => typeof layer.id === "number" && !layer.isGroup)
    .slice(0, groupFirstLayers);
  if (layers.length < groupFirstLayers) {
    throw new Error(`--group-first-layers requested ${groupFirstLayers} layers but only found ${layers.length} non-group layers`);
  }
  return {
    groupName: `${explicitGroupName}_${Date.now()}`,
    layers
  };
}

async function saveReport(report) {
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function collectRealtimeEvidence(firstTree, deadline) {
  if (!requireRealtime) return null;
  const firstSnapshotId = firstTree?.snapshot?.snapshotId || null;
  const firstCapturedAt = firstTree?.snapshot?.capturedAt || null;
  const firstReceivedAt = firstTree?.snapshot?.receivedAt || null;
  const realtimeDeadline = Math.min(deadline, Date.now() + realtimeWindowMs);
  let lastTree = firstTree;

  while (Date.now() < realtimeDeadline) {
    await wait(1000);
    const currentTree = await requestJson("/codex/layer-tree");
    lastTree = currentTree;
    if (currentTree?.snapshot?.snapshotId && currentTree.snapshot.snapshotId !== firstSnapshotId) {
      return {
        ok: true,
        firstSnapshotId,
        secondSnapshotId: currentTree.snapshot.snapshotId,
        firstCapturedAt,
        secondCapturedAt: currentTree.snapshot.capturedAt || null,
        firstReceivedAt,
        secondReceivedAt: currentTree.snapshot.receivedAt || null,
        elapsedMs: receivedElapsedMs(firstReceivedAt, currentTree.snapshot.receivedAt)
      };
    }
  }

  return {
    ok: false,
    firstSnapshotId,
    lastSnapshotId: lastTree?.snapshot?.snapshotId || null,
    firstCapturedAt,
    lastCapturedAt: lastTree?.snapshot?.capturedAt || null,
    firstReceivedAt,
    lastReceivedAt: lastTree?.snapshot?.receivedAt || null,
    timedOut: true,
    realtimeWindowMs
  };
}

function receivedElapsedMs(firstReceivedAt, secondReceivedAt) {
  if (!firstReceivedAt || !secondReceivedAt) return null;
  return Date.parse(secondReceivedAt) - Date.parse(firstReceivedAt);
}

async function waitForCommand(commandId, deadline) {
  let command = null;
  while (Date.now() < deadline) {
    const current = await requestJson(`/codex/commands/${commandId}`);
    command = current.command;
    if (command.status === "completed" || command.status === "failed") {
      return {
        ok: command.status === "completed",
        command
      };
    }
    await wait(1000);
  }
  return {
    ok: false,
    timedOut: true,
    command
  };
}

async function verifyRenameOperation(initialLayerTree) {
  if (!renameFirstLayer && renameLayerId === null && renameTo === null) return null;
  const target = renameFirstLayer
    ? renameTargetFromTree(initialLayerTree)
    : { layerId: renameLayerId, name: renameTo };
  if (typeof target.layerId !== "number" || Number.isNaN(target.layerId)) {
    throw new Error("--rename-layer-id must be numeric when rename verification is requested");
  }
  if (!target.name) {
    throw new Error("--rename-to is required when rename verification is requested");
  }

  const operations = [
    {
      op: "renameLayer",
      layerId: target.layerId,
      name: target.name
    }
  ];

  await requestJson("/codex/layer-operations/preview", {method:"POST",body:JSON.stringify({operations,...snapshotGuard(initialLayerTree.snapshot)})});
  const queued = await requestJson("/codex/layer-operations/queue", {
    method: "POST",
    body: JSON.stringify({
      operations,
      ...snapshotGuard(initialLayerTree.snapshot),
      reason: "runtime verifier rename check"
    })
  });

  const beforeTree = await requestJson("/codex/layer-tree");
  const beforeLayer = findLayerById(beforeTree.snapshot?.layers || [], target.layerId);
  const deadline = Date.now() + commandTimeoutMs;
  const commandResult = await waitForCommand(queued.command.id, deadline);
  if (!commandResult.ok) {
    return {
      ok: false,
      command: commandResult.command,
      timedOut: commandResult.timedOut,
      beforeLayer,
      target,
      afterState: null
    };
  }
  return {
    ok: true,
    command: commandResult.command,
    beforeLayer,
    target,
    afterState: await waitForLayerName(target.layerId, target.name, deadline)
  };
}

async function waitForLayerName(layerId, expectedName, deadline) {
  let lastLayer = null;
  let lastSnapshotId = null;
  while (Date.now() < deadline) {
    const tree = await requestJson("/codex/layer-tree");
    lastSnapshotId = tree.snapshot?.snapshotId || null;
    lastLayer = findLayerById(tree.snapshot?.layers || [], layerId);
    if (lastLayer?.name === expectedName) {
      return {
        ok: true,
        snapshotId: lastSnapshotId,
        layer: lastLayer
      };
    }
    await wait(1000);
  }
  return {
    ok: false,
    snapshotId: lastSnapshotId,
    layer: lastLayer
  };
}

async function verifyPrefixGroupingOperation() {
  if (!groupPrefixDelimiter) return null;
  if (!Number.isInteger(groupMinSize) || groupMinSize < 1) {
    throw new Error("--group-min-size must be a positive integer");
  }

  const plan = await requestJson("/codex/grouping-plans/prefix", {
    method: "POST",
    body: JSON.stringify({
      delimiter: groupPrefixDelimiter,
      minGroupSize: groupMinSize,
      groupNamePrefix,
      queue: true,
      reason: "runtime verifier prefix grouping check"
    })
  });
  if (!plan.queued) {
    return {
      ok: false,
      reason: "No grouping operations were generated",
      plan
    };
  }

  const deadline = Date.now() + commandTimeoutMs;
  const commandResult = await waitForCommand(plan.queued.command.id, deadline);
  if (!commandResult.ok) {
    return {
      ok: false,
      command: commandResult.command,
      timedOut: commandResult.timedOut,
      plan,
      afterState: null
    };
  }

  return {
    ok: true,
    command: commandResult.command,
    plan,
    afterState: await waitForGroupingPlan(plan, deadline)
  };
}

async function verifyExplicitGroupingOperation(initialLayerTree) {
  const target = groupTargetsFromTree(initialLayerTree);
  if (!target) return null;
  const groupAlias = "runtime_group";
  const operations = [
    {
      op: "createGroup",
      name: target.groupName,
      assignAlias: groupAlias
    },
    ...target.layers.map(layer => ({
      op: "moveLayerToGroup",
      layerId: layer.id,
      groupAlias
    }))
  ];

  await requestJson("/codex/layer-operations/preview", {method:"POST",body:JSON.stringify({operations,...snapshotGuard(initialLayerTree.snapshot)})});
  const queued = await requestJson("/codex/layer-operations/queue", {
    method: "POST",
    body: JSON.stringify({
      operations,
      ...snapshotGuard(initialLayerTree.snapshot),
      reason: "runtime verifier explicit grouping check"
    })
  });
  const deadline = Date.now() + commandTimeoutMs;
  const commandResult = await waitForCommand(queued.command.id, deadline);
  if (!commandResult.ok) {
    return {
      ok: false,
      command: commandResult.command,
      timedOut: commandResult.timedOut,
      target,
      afterState: null
    };
  }

  return {
    ok: true,
    command: commandResult.command,
    target,
    afterState: await waitForExplicitGroup(target, deadline)
  };
}

async function waitForExplicitGroup(target, deadline) {
  let lastSnapshotId = null;
  let groupLayer = null;
  let movedLayers = [];
  while (Date.now() < deadline) {
    const tree = await requestJson("/codex/layer-tree");
    lastSnapshotId = tree.snapshot?.snapshotId || null;
    const layers = tree.snapshot?.layers || [];
    groupLayer = findLayerByName(layers, target.groupName);
    movedLayers = target.layers.map(layer => findLayerById(layers, layer.id));
    if (groupLayer && movedLayers.every(layer => layer?.parentId === groupLayer.id)) {
      return {
        ok: true,
        snapshotId: lastSnapshotId,
        groupLayer,
        movedLayers
      };
    }
    await wait(1000);
  }
  return {
    ok: false,
    snapshotId: lastSnapshotId,
    groupLayer,
    movedLayers
  };
}

async function waitForGroupingPlan(plan, deadline) {
  let lastSnapshotId = null;
  let lastGroups = [];
  while (Date.now() < deadline) {
    const tree = await requestJson("/codex/layer-tree");
    lastSnapshotId = tree.snapshot?.snapshotId || null;
    const layers = tree.snapshot?.layers || [];
    lastGroups = plan.groups.map(group => {
      const groupLayer = findLayerByName(layers, group.name);
      const movedLayers = group.layerIds.map(layerId => findLayerById(layers, layerId));
      return {
        expectedName: group.name,
        groupLayer,
        movedLayers,
        ok: Boolean(groupLayer) && movedLayers.every(layer => layer?.parentId === groupLayer.id)
      };
    });
    if (lastGroups.length && lastGroups.every(group => group.ok)) {
      return {
        ok: true,
        snapshotId: lastSnapshotId,
        groups: lastGroups
      };
    }
    await wait(1000);
  }
  return {
    ok: false,
    snapshotId: lastSnapshotId,
    groups: lastGroups
  };
}

function findLayerByName(layers, name) {
  for (const layer of layers || []) {
    if (layer.name === name) return layer;
    const child = findLayerByName(layer.layers || [], name);
    if (child) return child;
  }
  return null;
}

try {
  const broker = await ensureBroker();
  const deadline = Date.now() + timeoutMs;
  let lastStatus = null;

  while (Date.now() < deadline) {
    lastStatus = await requestHealth();
    if (isReady(lastStatus)) {
      const initialLayerTree = await requestJson("/codex/layer-tree");
      const realtimeEvidence = await collectRealtimeEvidence(initialLayerTree, deadline);
      const renameVerification = await verifyRenameOperation(initialLayerTree);
      const groupingVerification = await verifyPrefixGroupingOperation();
      const explicitGroupingVerification = await verifyExplicitGroupingOperation(initialLayerTree);
      const finalLayerTree = await requestJson("/codex/layer-tree");
      const layerStateSummary = await requestJson("/codex/layer-state-summary");
      const renameOk = !renameVerification || (renameVerification.ok && renameVerification.afterState?.ok);
      const groupingOk = !groupingVerification || (groupingVerification.ok && groupingVerification.afterState?.ok);
      const explicitGroupingOk = !explicitGroupingVerification || (explicitGroupingVerification.ok && explicitGroupingVerification.afterState?.ok);
      const realtimeOk = !requireRealtime || realtimeEvidence?.ok;
      const report = {
        ok: renameOk && groupingOk && explicitGroupingOk && realtimeOk,
        broker,
        verifiedAt: new Date().toISOString(),
        requirement: {
          polling: true,
          hasDocument: true,
          nonSmokeRuntime: true,
          realtime: requireRealtime,
          realtimeWindowMs: requireRealtime ? realtimeWindowMs : null,
          minLayerCount,
          maxSnapshotAgeMs
        },
        status: lastStatus,
        initialLayerTree,
        realtimeEvidence,
        finalLayerTree,
        layerStateSummary,
        renameVerification,
        groupingVerification,
        explicitGroupingVerification
      };
      await saveReport(report);
      if (renameVerification && !renameVerification.ok) {
        console.log(`Photoshop runtime read verified but rename check failed: ${outPath}`);
        process.exit(1);
      }
      if (renameVerification && !renameVerification.afterState?.ok) {
        console.log(`Photoshop command completed but renamed layer was not observed in a fresh snapshot: ${outPath}`);
        process.exit(1);
      }
      if (groupingVerification && !groupingVerification.ok) {
        console.log(`Photoshop runtime read verified but grouping check failed: ${outPath}`);
        process.exit(1);
      }
      if (groupingVerification && !groupingVerification.afterState?.ok) {
        console.log(`Photoshop grouping command completed but grouped layers were not observed in a fresh snapshot: ${outPath}`);
        process.exit(1);
      }
      if (explicitGroupingVerification && !explicitGroupingVerification.ok) {
        console.log(`Photoshop runtime read verified but explicit grouping check failed: ${outPath}`);
        process.exit(1);
      }
      if (explicitGroupingVerification && !explicitGroupingVerification.afterState?.ok) {
        console.log(`Photoshop explicit grouping command completed but grouped layers were not observed in a fresh snapshot: ${outPath}`);
        process.exit(1);
      }
      if (requireRealtime && !realtimeEvidence?.ok) {
        console.log(`Photoshop runtime read verified but realtime snapshot refresh was not observed: ${outPath}`);
        process.exit(1);
      }
      console.log(`Photoshop runtime verified: ${outPath}`);
      process.exit(0);
    }
    await wait(1000);
  }

  const report = {
    ok: false,
    timedOut: true,
    broker,
    verifiedAt: new Date().toISOString(),
    requirement: {
      polling: true,
      hasDocument: true,
      nonSmokeRuntime: true,
      realtime: requireRealtime,
      realtimeWindowMs: requireRealtime ? realtimeWindowMs : null,
      minLayerCount,
      maxSnapshotAgeMs
    },
    status: lastStatus
  };
  await saveReport(report);
  console.log(`Photoshop runtime not ready before timeout: ${outPath}`);
  process.exit(expectTimeout ? 0 : 1);
} finally {
  if (serverProcess) {
    serverProcess.kill();
  }
}
