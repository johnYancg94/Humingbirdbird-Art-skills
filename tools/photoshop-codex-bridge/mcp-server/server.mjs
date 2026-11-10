import {snapshotGuard,assertSnapshotGuard} from "./snapshot-guard.mjs";
import http from "node:http";
import { createHash, randomUUID } from "node:crypto";

const host = process.env.PS_BRIDGE_HOST || "127.0.0.1";
const port = Number(process.env.PS_BRIDGE_PORT || "47777");
const maxRequestBodyChars = Number(process.env.PS_BRIDGE_MAX_BODY_CHARS || "50000000");
const snapshotRequestTimeoutMs = Number(process.env.PS_BRIDGE_SNAPSHOT_TIMEOUT_MS || "60000");

let latestSnapshot = null;
let latestClientStatus = null;
const snapshotHistory = [];
const pendingSnapshotRequests = [];
const pendingCommandIds = [];
const commandsById = new Map();
const commandResults = [];
const supportedOperations = new Set(["renameLayer", "setVisibility", "createGroup", "moveLayerToGroup", "moveLayerBefore", "mergeGroupToLayer", "deleteLayer", "setLayerColor", "rasterizeLayer", "saveDocument"]);

function jsonResponse(res, statusCode, body) {
  const data = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data)
  });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > maxRequestBodyChars) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function normalizeSnapshotScope(options = {}) {
  if (options.full === true || options.maxDepth === null) {
    return { maxDepth: null };
  }
  const requestedDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : 1;
  return {
    maxDepth: Math.max(0, Math.min(requestedDepth, 12))
  };
}

function sameSnapshotScope(left, right) {
  return left?.maxDepth === right?.maxDepth;
}

function snapshotRequestView(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    reason: entry.reason,
    scope: entry.scope,
    requestedAt: entry.requestedAt
  };
}

function removeSnapshotRequest(requestId) {
  const index = pendingSnapshotRequests.findIndex(entry => entry.id === requestId);
  if (index < 0) return null;
  return pendingSnapshotRequests.splice(index, 1)[0];
}

function requestFreshSnapshot(options = {}, reason = "layer tree requested") {
  const scope = normalizeSnapshotScope(options);
  const existing = pendingSnapshotRequests.find(entry => sameSnapshotScope(entry.scope, scope));
  if (existing) return existing.promise;

  const request = {
    id: randomUUID(),
    reason,
    scope,
    requestedAt: new Date().toISOString()
  };
  request.promise = new Promise((resolve, reject) => {
    request.resolve = resolve;
    request.reject = reject;
    request.timer = setTimeout(() => {
      removeSnapshotRequest(request.id);
      reject(new Error(
        "Photoshop did not return the requested layer snapshot within the timeout. " +
        "Open the Photoshop Codex Bridge panel and keep Photoshop responsive, then try again."
      ));
    }, snapshotRequestTimeoutMs);
  });
  pendingSnapshotRequests.push(request);
  return request.promise;
}

function acceptSnapshot(body) {
  const requestId = typeof body.requestId === "string" ? body.requestId : null;
  const snapshotBody = { ...body };
  delete snapshotBody.requestId;
  const receivedAt = new Date().toISOString();
  latestSnapshot = {
    ...snapshotBody,
    receivedAt,
    snapshotId: buildSnapshotId(snapshotBody, receivedAt)
  };
  rememberSnapshot(latestSnapshot);

  if (requestId) {
    const request = removeSnapshotRequest(requestId);
    if (request) {
      clearTimeout(request.timer);
      request.resolve(latestSnapshot);
    }
  }
  return latestSnapshot;
}

function rejectSnapshot(body) {
  const requestId = typeof body.requestId === "string" ? body.requestId : null;
  const message = typeof body.error === "string" && body.error
    ? body.error
    : "Photoshop could not create the requested layer snapshot.";
  if (!requestId) return false;
  const request = removeSnapshotRequest(requestId);
  if (!request) return false;
  clearTimeout(request.timer);
  request.reject(new Error(message));
  return true;
}

function startBroker() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${host}:${port}`);

      if (req.method === "GET" && url.pathname === "/health") {
        jsonResponse(res, 200, buildBridgeStatus());
        return;
      }

      if (req.method === "POST" && url.pathname === "/photoshop/snapshot") {
        const body = await readJson(req);
        const snapshot = acceptSnapshot(body);
        jsonResponse(res, 200, { ok: true, snapshotId: snapshot.snapshotId });
        return;
      }

      if (req.method === "POST" && url.pathname === "/photoshop/snapshot/error") {
        const body = await readJson(req);
        jsonResponse(res, 200, { ok: true, matched: rejectSnapshot(body) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/photoshop/status") {
        const body = await readJson(req);
        latestClientStatus = {
          ...body,
          receivedAt: new Date().toISOString()
        };
        jsonResponse(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && url.pathname === "/codex/layer-tree") {
        jsonResponse(res, 200, {
          ok: true,
          connected: Boolean(latestSnapshot),
          layerCount: flattenSnapshotLayers(latestSnapshot).size,
          snapshot: latestSnapshot
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/photoshop/requests/next") {
        jsonResponse(res, 200, {
          snapshotRequest: snapshotRequestView(pendingSnapshotRequests[0])
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/codex/snapshot/request") {
        const body = await readJson(req);
        const snapshot = await requestFreshSnapshot(body, body.reason || "HTTP client requested the layer tree");
        jsonResponse(res, 200, {
          ok: true,
          connected: true,
          layerCount: flattenSnapshotLayers(snapshot).size,
          partial: snapshot.scope?.maxDepth !== null,
          scope: snapshot.scope,
          snapshot
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/codex/layer-state-summary") {
        jsonResponse(res, 200, buildLayerStateSummary());
        return;
      }

      if (req.method === "GET" && url.pathname === "/codex/snapshots") {
        jsonResponse(res, 200, {
          ok: true,
          snapshots: snapshotHistory.map(snapshotSummary)
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/codex/layer-diff/latest") {
        jsonResponse(res, 200, {
          ok: true,
          diff: latestLayerDiff()
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/photoshop/commands/next") {
        const commandId = pendingCommandIds.shift() || null;
        const command = commandId ? commandsById.get(commandId) : null;
        if (command) {
          command.status = "delivered";
          command.deliveredAt = new Date().toISOString();
        }
        jsonResponse(res, 200, { command });
        return;
      }

      if (req.method === "POST" && url.pathname === "/codex/layer-operations/preview") {
        const body = await readJson(req);
        const operations = normalizeOperations(body.operations);
        if(body.expectedSnapshotId) assertSnapshotGuard(latestSnapshot,body);
        jsonResponse(res, 200, {
          ok: true,
          snapshotId: latestSnapshot.snapshotId,
          document: latestSnapshot.document || null,
          preview: previewOperations(operations)
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/codex/layer-operations/queue") {
        const body = await readJson(req);
        const operations = normalizeOperations(body.operations);
        const queued = queueLayerOperations(operations, body.reason || "", body);
        jsonResponse(res, 200, queued);
        return;
      }

      if (req.method === "POST" && url.pathname === "/codex/rename-plans/tree-order") {
        const body = await readJson(req);
        const plan = buildTreeOrderRenamePlan(body);
        if (body.queue) {
          jsonResponse(res, 200, {
            ...plan,
            queued: plan.operations.length
              ? queueLayerOperations(plan.operations, body.reason || "tree-order rename plan", snapshotGuard(latestSnapshot))
              : null
          });
          return;
        }
        jsonResponse(res, 200, plan);
        return;
      }

      if (req.method === "POST" && url.pathname === "/codex/grouping-plans/prefix") {
        const body = await readJson(req);
        const plan = buildPrefixGroupingPlan(body);
        if (body.queue) {
          jsonResponse(res, 200, {
            ...plan,
            queued: plan.operations.length
              ? queueLayerOperations(plan.operations, body.reason || "prefix grouping plan", snapshotGuard(latestSnapshot))
              : null
          });
          return;
        }
        jsonResponse(res, 200, plan);
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/codex/commands/")) {
        const commandId = url.pathname.split("/")[3];
        const command = commandsById.get(commandId);
        if (!command) {
          jsonResponse(res, 404, { error: `Command ${commandId} was not found` });
          return;
        }
        jsonResponse(res, 200, {
          ok: true,
          command: commandView(command)
        });
        return;
      }

      if (req.method === "POST" && url.pathname.startsWith("/codex/commands/") && url.pathname.endsWith("/cancel")) {
        const commandId = url.pathname.split("/")[3];
        const body = await readJson(req);
        jsonResponse(res, 200, cancelPendingCommand(commandId, body.reason || ""));
        return;
      }

      if (req.method === "POST" && url.pathname.startsWith("/photoshop/commands/") && url.pathname.endsWith("/result")) {
        const commandId = url.pathname.split("/")[3];
        const body = await readJson(req);
        const command = commandsById.get(commandId);
        if (command) {
          command.status = body.ok ? "completed" : "failed";
          command.completedAt = new Date().toISOString();
          command.result = body;
        }
        commandResults.push({
          commandId,
          ...body,
          receivedAt: new Date().toISOString()
        });
        while (commandResults.length > 100) commandResults.shift();
        jsonResponse(res, 200, { ok: true });
        return;
      }

      jsonResponse(res, 404, { error: "Not found" });
    } catch (error) {
      jsonResponse(res, 400, { error: error.message });
    }
  });

  server.listen(port, host);
  return server;
}

function toolResult(value) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function queueCommand(type, payload) {
  const command = {
    id: randomUUID(),
    type,
    payload,
    status: "queued",
    queuedAt: new Date().toISOString()
  };
  commandsById.set(command.id, command);
  pendingCommandIds.push(command.id);
  return command;
}

function buildSnapshotId(snapshot, receivedAt) {
  const layerKeys = [];
  walkLayers(snapshot?.layers || [], layer => {
    layerKeys.push([
      layer.id,
      layer.name,
      layer.visible,
      layer.isGroup,
      layer.childCount
    ].join(":"));
  });
  return createHash("sha256")
    .update(JSON.stringify({
      documentId: snapshot?.document?.id ?? null,
      documentTitle: snapshot?.document?.title ?? null,
      capturedAt: snapshot?.capturedAt ?? null,
      receivedAt,
      layerKeys
    }))
    .digest("hex")
    .slice(0, 16);
}

function rememberSnapshot(snapshot) {
  snapshotHistory.push(snapshot);
  while (snapshotHistory.length > 20) snapshotHistory.shift();
}

function snapshotSummary(snapshot) {
  return {
    snapshotId: snapshot.snapshotId,
    receivedAt: snapshot.receivedAt,
    capturedAt: snapshot.capturedAt || null,
    document: snapshot.document || null,
    layerCount: flattenSnapshotLayers(snapshot).size
  };
}

function latestLayerDiff() {
  if (snapshotHistory.length < 2) {
    return {
      available: false,
      reason: "Need at least two snapshots"
    };
  }
  const before = snapshotHistory[snapshotHistory.length - 2];
  const after = snapshotHistory[snapshotHistory.length - 1];
  return diffSnapshots(before, after);
}

function layerDiffView(layer) {
  return {
    id: layer.id,
    name: layer.name,
    parentId: layer.parentId ?? null,
    visible: layer.visible,
    isGroup: layer.isGroup,
    path: layer.path || [],
    treeOrder: layer.treeOrder
  };
}

function diffSnapshots(before, after) {
  const beforeLayers = flattenSnapshotLayers(before);
  const afterLayers = flattenSnapshotLayers(after);
  const added = [];
  const removed = [];
  const changed = [];

  for (const [id, layer] of afterLayers.entries()) {
    if (!beforeLayers.has(id)) {
      added.push(layerDiffView(layer));
      continue;
    }
    const previous = beforeLayers.get(id);
    const changes = {};
    for (const field of ["name", "parentId", "visible", "isGroup", "treeOrder"]) {
      if ((previous[field] ?? null) !== (layer[field] ?? null)) {
        changes[field] = {
          from: previous[field] ?? null,
          to: layer[field] ?? null
        };
      }
    }
    if (Object.keys(changes).length) {
      changed.push({
        id,
        before: layerDiffView(previous),
        after: layerDiffView(layer),
        changes
      });
    }
  }

  for (const [id, layer] of beforeLayers.entries()) {
    if (!afterLayers.has(id)) {
      removed.push(layerDiffView(layer));
    }
  }

  return {
    available: true,
    fromSnapshotId: before.snapshotId,
    toSnapshotId: after.snapshotId,
    document: after.document || null,
    added,
    removed,
    changed
  };
}

function commandView(command) {
  return {
    id: command.id,
    type: command.type,
    status: command.status,
    queuedAt: command.queuedAt,
    deliveredAt: command.deliveredAt,
    completedAt: command.completedAt,
    expectedSnapshotId: command.payload?.expectedSnapshotId ?? null,
    expectedDocumentId: command.payload?.expectedDocumentId ?? null,
    expectedDocumentTitle: command.payload?.expectedDocumentTitle ?? null,
    preview: command.payload?.preview || [],
    result: command.result || null
  };
}

function cancelPendingCommand(commandId, reason = "") {
  const command = commandsById.get(commandId);
  if (!command) {
    throw new Error(`Command ${commandId} was not found`);
  }
  if (command.status !== "queued") {
    throw new Error(`Command ${commandId} cannot be cancelled because status is ${command.status}`);
  }
  const pendingIndex = pendingCommandIds.indexOf(commandId);
  if (pendingIndex < 0) {
    throw new Error(`Command ${commandId} is not pending delivery`);
  }
  pendingCommandIds.splice(pendingIndex, 1);
  command.status = "cancelled";
  command.completedAt = new Date().toISOString();
  command.result = {
    ok: false,
    cancelled: true,
    reason
  };
  commandResults.push({
    commandId,
    ...command.result,
    receivedAt: command.completedAt
  });
  while (commandResults.length > 100) commandResults.shift();
  return {
    ok: true,
    command: commandView(command)
  };
}

function getSnapshotAgeMs() {
  if (!latestSnapshot?.receivedAt) return null;
  return Date.now() - Date.parse(latestSnapshot.receivedAt);
}

function recentCommands(limit = 20) {
  return Array.from(commandsById.values()).slice(-limit).map(commandView);
}

function buildBridgeStatus() {
  return {
    ok: true,
    broker: {
      host,
      port
    },
    photoshop: {
      hasSnapshot: Boolean(latestSnapshot),
      snapshotId: latestSnapshot?.snapshotId ?? null,
      snapshotAgeMs: getSnapshotAgeMs(),
      pendingSnapshotRequest: snapshotRequestView(pendingSnapshotRequests[0]),
      latestClientStatus
    },
    commands: {
      pending: pendingCommandIds.length,
      total: commandsById.size,
      recent: recentCommands()
    }
  };
}

function walkLayers(layers, visitor, parent = null) {
  for (const layer of layers || []) {
    visitor(layer, parent);
    if (Array.isArray(layer.layers)) {
      walkLayers(layer.layers, visitor, layer);
    }
  }
}

function flattenSnapshotLayers(snapshot) {
  const layersById = new Map();
  let treeOrder = 0;
  walkLayers(snapshot?.layers || [], (layer, parent) => {
    if (typeof layer.id === "number") {
      layersById.set(layer.id, {
        ...layer,
        parentId: parent?.id ?? null,
        treeOrder
      });
      treeOrder += 1;
    }
  });
  return layersById;
}

function buildLayerStateSummary() {
  const layersById = flattenSnapshotLayers(latestSnapshot);
  const layers = Array.from(layersById.values());
  const descriptor = {
    ok: 0,
    failed: 0,
    missing: 0
  };
  let groups = 0;
  let leafLayers = 0;
  let hidden = 0;
  let locked = 0;
  let withBounds = 0;
  let maxDepth = 0;

  for (const layer of layers) {
    if (layer.isGroup) groups += 1;
    else leafLayers += 1;
    if (layer.visible === false) hidden += 1;
    if (layer.locked === true) locked += 1;
    if (layer.bounds || layer.descriptor?.bounds || layer.descriptor?.boundsNoEffects) withBounds += 1;
    if (typeof layer.depth === "number") maxDepth = Math.max(maxDepth, layer.depth);
    if (!layer.descriptor || typeof layer.descriptor !== "object") {
      descriptor.missing += 1;
    } else if (layer.descriptor.ok === true) {
      descriptor.ok += 1;
    } else {
      descriptor.failed += 1;
    }
  }

  return {
    ok: true,
    connected: Boolean(latestSnapshot),
    snapshotId: latestSnapshot?.snapshotId ?? null,
    receivedAt: latestSnapshot?.receivedAt ?? null,
    capturedAt: latestSnapshot?.capturedAt ?? null,
    snapshotAgeMs: getSnapshotAgeMs(),
    document: latestSnapshot?.document || null,
    layerState: {
      totalLayers: layers.length,
      groups,
      leafLayers,
      hidden,
      locked,
      maxDepth,
      withBounds,
      descriptor
    }
  };
}

function validateOperation(operation, layersById, aliases = new Set()) {
  if (!operation || typeof operation !== "object") {
    throw new Error("Each operation must be an object");
  }
  if (!supportedOperations.has(operation.op)) {
    throw new Error(`Unsupported operation: ${operation.op}`);
  }

  if (operation.op === "renameLayer") {
    if (typeof operation.layerId !== "number") throw new Error("renameLayer requires numeric layerId");
    if (!layersById.has(operation.layerId)) throw new Error(`Layer ${operation.layerId} was not found in latest snapshot`);
    if (typeof operation.name !== "string" || !operation.name.trim()) throw new Error("renameLayer requires a non-empty name");
  }

  if (operation.op === "setVisibility") {
    if (typeof operation.layerId !== "number") throw new Error("setVisibility requires numeric layerId");
    if (!layersById.has(operation.layerId)) throw new Error(`Layer ${operation.layerId} was not found in latest snapshot`);
    if (typeof operation.visible !== "boolean") throw new Error("setVisibility requires boolean visible");
  }

  if (operation.op === "createGroup") {
    if (typeof operation.name !== "string" || !operation.name.trim()) throw new Error("createGroup requires a non-empty name");
    if (operation.assignAlias !== undefined && (typeof operation.assignAlias !== "string" || !operation.assignAlias.trim())) {
      throw new Error("createGroup assignAlias must be a non-empty string when provided");
    }
    if (operation.parentLayerId !== undefined && typeof operation.parentLayerId !== "number") {
      throw new Error("createGroup parentLayerId must be numeric when provided");
    }
    if (operation.parentLayerId !== undefined) {
      const parent = layersById.get(operation.parentLayerId);
      if (!parent) throw new Error(`Parent layer ${operation.parentLayerId} was not found in latest snapshot`);
      if (!parent.isGroup) throw new Error(`Parent layer ${operation.parentLayerId} is not a group`);
    }
    if (operation.assignAlias) {
      if (aliases.has(operation.assignAlias)) throw new Error(`Alias ${operation.assignAlias} is already assigned`);
      aliases.add(operation.assignAlias);
    }
  }

  if (operation.op === "moveLayerToGroup") {
    if (typeof operation.layerId !== "number") throw new Error("moveLayerToGroup requires numeric layerId");
    if (operation.groupAlias !== undefined && (typeof operation.groupAlias !== "string" || !operation.groupAlias.trim())) {
      throw new Error("moveLayerToGroup groupAlias must be a non-empty string when provided");
    }
    if (operation.groupLayerId === undefined && operation.groupAlias === undefined) {
      throw new Error("moveLayerToGroup requires groupLayerId or groupAlias");
    }
    if (operation.groupLayerId !== undefined && typeof operation.groupLayerId !== "number") {
      throw new Error("moveLayerToGroup groupLayerId must be numeric when provided");
    }
    if (!layersById.has(operation.layerId)) throw new Error(`Layer ${operation.layerId} was not found in latest snapshot`);
    if (operation.groupAlias !== undefined && !aliases.has(operation.groupAlias)) {
      throw new Error(`Alias ${operation.groupAlias} has not been assigned by an earlier createGroup operation`);
    }
    const group = operation.groupLayerId !== undefined ? layersById.get(operation.groupLayerId) : null;
    if (operation.groupLayerId !== undefined && !group) throw new Error(`Group layer ${operation.groupLayerId} was not found in latest snapshot`);
    if (operation.groupLayerId !== undefined && !group.isGroup) throw new Error(`Layer ${operation.groupLayerId} is not a group`);
    if (operation.layerId === operation.groupLayerId) throw new Error("Cannot move a group into itself");
  }

  if (operation.op === "moveLayerBefore") {
    if (typeof operation.layerId !== "number" || typeof operation.beforeLayerId !== "number") throw new Error("moveLayerBefore requires numeric layerId and beforeLayerId");
    const layer = layersById.get(operation.layerId);
    const before = layersById.get(operation.beforeLayerId);
    if (!layer || !before) throw new Error("moveLayerBefore source or reference layer was not found in latest snapshot");
    if (layer.parentId !== before.parentId) throw new Error("moveLayerBefore requires layers with the same parent");
    if (operation.layerId === operation.beforeLayerId) throw new Error("Cannot move a layer before itself");
  }

  if (operation.op === "mergeGroupToLayer") {
    if (typeof operation.groupLayerId !== "number") throw new Error("mergeGroupToLayer requires numeric groupLayerId");
    const group = layersById.get(operation.groupLayerId);
    if (!group) throw new Error(`Group layer ${operation.groupLayerId} was not found in latest snapshot`);
    if (!group.isGroup) throw new Error(`Layer ${operation.groupLayerId} is not a group`);
    if (typeof operation.name !== "string" || !operation.name.trim()) throw new Error("mergeGroupToLayer requires a non-empty name");
  }

  if (operation.op === "deleteLayer") {
    if (typeof operation.layerId !== "number") throw new Error("deleteLayer requires numeric layerId");
    if (!layersById.has(operation.layerId)) throw new Error(`Layer ${operation.layerId} was not found in latest snapshot`);
  }

  if (operation.op === "setLayerColor") {
    const allowedColors = new Set(["none", "red", "orange", "yellowColor", "green", "blue", "violet", "gray"]);
    if (typeof operation.layerId !== "number") throw new Error("setLayerColor requires numeric layerId");
    if (!layersById.has(operation.layerId)) throw new Error(`Layer ${operation.layerId} was not found in latest snapshot`);
    if (typeof operation.color !== "string" || !allowedColors.has(operation.color)) {
      throw new Error("setLayerColor requires color to be one of: none, red, orange, yellowColor, green, blue, violet, gray");
    }
  }

  if (operation.op === "rasterizeLayer") {
    if (typeof operation.layerId !== "number") throw new Error("rasterizeLayer requires numeric layerId");
    const layer = layersById.get(operation.layerId);
    if (!layer) throw new Error(`Layer ${operation.layerId} was not found in latest snapshot`);
    if (layer.isGroup) throw new Error(`Layer ${operation.layerId} is a group and cannot be rasterized`);
  }
}

function previewOperations(operations) {
  const layersById = flattenSnapshotLayers(latestSnapshot);
  if (!latestSnapshot) {
    throw new Error("No Photoshop snapshot is available. Open the Photoshop Codex Bridge panel first.");
  }
  const aliases = new Set();
  for (const operation of operations) {
    validateOperation(operation, layersById, aliases);
  }

  return operations.map(operation => {
    if (operation.op === "renameLayer") {
      const layer = layersById.get(operation.layerId);
      return {
        op: operation.op,
        layerId: operation.layerId,
        from: layer.name,
        to: operation.name
      };
    }
    if (operation.op === "setVisibility") {
      const layer = layersById.get(operation.layerId);
      return {
        op: operation.op,
        layerId: operation.layerId,
        from: layer.visible,
        to: operation.visible
      };
    }
    if (operation.op === "createGroup") {
      return {
        op: operation.op,
        name: operation.name,
        parentLayerId: operation.parentLayerId ?? null,
        assignAlias: operation.assignAlias ?? null
      };
    }
    if (operation.op === "moveLayerToGroup") {
      const layer = layersById.get(operation.layerId);
      const group = operation.groupLayerId !== undefined ? layersById.get(operation.groupLayerId) : null;
      return {
        op: operation.op,
        layerId: operation.layerId,
        layerName: layer.name,
        fromParentId: layer.parentId,
        groupLayerId: operation.groupLayerId ?? null,
        groupAlias: operation.groupAlias ?? null,
        groupName: group ? group.name : null
      };
    }
    if (operation.op === "moveLayerBefore") {
      const layer = layersById.get(operation.layerId);
      const before = layersById.get(operation.beforeLayerId);
      return { op: operation.op, layerId: layer.id, layerName: layer.name, beforeLayerId: before.id, beforeLayerName: before.name, parentLayerId: layer.parentId ?? null };
    }
    if (operation.op === "mergeGroupToLayer") {
      const group = layersById.get(operation.groupLayerId);
      return {
        op: operation.op,
        groupLayerId: operation.groupLayerId,
        from: group.name,
        to: operation.name,
        childCount: group.childCount ?? 0,
        parentLayerId: group.parentId ?? null
      };
    }
    if (operation.op === "deleteLayer") {
      const layer = layersById.get(operation.layerId);
      return {
        op: operation.op,
        layerId: operation.layerId,
        name: layer.name,
        parentLayerId: layer.parentId ?? null,
        childCount: layer.childCount ?? 0
      };
    }
    if (operation.op === "setLayerColor") {
      const layer = layersById.get(operation.layerId);
      return {
        op: operation.op,
        layerId: operation.layerId,
        name: layer.name,
        color: operation.color
      };
    }
    if (operation.op === "saveDocument") {
      return { op: operation.op, documentTitle: latestSnapshot.document?.title ?? null };
    }
    if (operation.op === "rasterizeLayer") {
      const layer = layersById.get(operation.layerId);
      return {
        op: operation.op,
        layerId: operation.layerId,
        name: layer.name,
        kind: layer.kind,
        parentLayerId: layer.parentId ?? null
      };
    }
    return operation;
  });
}

function normalizeOperations(operations) {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error("operations must contain at least one operation");
  }
  return operations;
}

function queueLayerOperations(operations, reason = "", expected = {}) {
  assertSnapshotGuard(latestSnapshot, expected);
  const preview = previewOperations(operations);
  const command = queueCommand("layerOperations", {
    operations,
    preview,
    expectedSnapshotId: latestSnapshot.snapshotId,
    expectedDocumentId: latestSnapshot.document?.id ?? null,
    expectedDocumentTitle: latestSnapshot.document?.title ?? null,
    reason
  });
  return {
    ok: true,
    queued: true,
    command: commandView(command),
    snapshotId: latestSnapshot.snapshotId,
    document: latestSnapshot.document || null,
    preview,
    pendingCommands: pendingCommandIds.length
  };
}

function buildTreeOrderRenamePlan(options = {}) {
  if (!latestSnapshot) {
    throw new Error("No Photoshop snapshot is available. Open the Photoshop Codex Bridge panel first.");
  }

  const prefix = typeof options.prefix === "string" ? options.prefix : "";
  const separator = typeof options.separator === "string" ? options.separator : "_";
  const startAt = Number.isInteger(options.startAt) ? options.startAt : 1;
  const pad = Number.isInteger(options.pad) ? options.pad : 3;
  const includeGroups = Boolean(options.includeGroups);
  const preserveOriginalName = options.preserveOriginalName !== false;
  const layers = Array.from(flattenSnapshotLayers(latestSnapshot).values())
    .sort((a, b) => a.treeOrder - b.treeOrder)
    .filter(layer => includeGroups || !layer.isGroup);

  const operations = [];
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    const number = String(startAt + index).padStart(pad, "0");
    const name = preserveOriginalName
      ? `${prefix}${number}${separator}${layer.name}`
      : `${prefix}${number}`;
    if (name !== layer.name) {
      operations.push({
        op: "renameLayer",
        layerId: layer.id,
        name
      });
    }
  }

  return {
    ok: true,
    snapshotId: latestSnapshot.snapshotId,
    document: latestSnapshot.document || null,
    options: {
      prefix,
      separator,
      startAt,
      pad,
      includeGroups,
      preserveOriginalName
    },
    operations,
    preview: operations.length ? previewOperations(operations) : []
  };
}

function buildPrefixGroupingPlan(options = {}) {
  if (!latestSnapshot) {
    throw new Error("No Photoshop snapshot is available. Open the Photoshop Codex Bridge panel first.");
  }

  const delimiter = typeof options.delimiter === "string" && options.delimiter
    ? options.delimiter
    : "_";
  const minGroupSize = Number.isInteger(options.minGroupSize) ? options.minGroupSize : 2;
  const groupNamePrefix = typeof options.groupNamePrefix === "string" ? options.groupNamePrefix : "";
  const includeGroups = Boolean(options.includeGroups);
  const layers = Array.from(flattenSnapshotLayers(latestSnapshot).values())
    .sort((a, b) => a.treeOrder - b.treeOrder)
    .filter(layer => includeGroups || !layer.isGroup);
  const groups = new Map();

  for (const layer of layers) {
    if (typeof layer.name !== "string" || !layer.name.includes(delimiter)) continue;
    const prefix = layer.name.split(delimiter)[0].trim();
    if (!prefix) continue;
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(layer);
  }

  const operations = [];
  const plannedGroups = [];
  for (const [prefix, groupLayers] of groups.entries()) {
    if (groupLayers.length < minGroupSize) continue;
    const alias = `group_${prefix.replace(/[^a-zA-Z0-9_-]+/g, "_")}`;
    const name = `${groupNamePrefix}${prefix}`;
    operations.push({
      op: "createGroup",
      name,
      assignAlias: alias
    });
    for (const layer of groupLayers) {
      operations.push({
        op: "moveLayerToGroup",
        layerId: layer.id,
        groupAlias: alias
      });
    }
    plannedGroups.push({
      prefix,
      name,
      alias,
      layerIds: groupLayers.map(layer => layer.id)
    });
  }

  return {
    ok: true,
    snapshotId: latestSnapshot.snapshotId,
    document: latestSnapshot.document || null,
    options: {
      delimiter,
      minGroupSize,
      groupNamePrefix,
      includeGroups
    },
    groups: plannedGroups,
    operations,
    preview: operations.length ? previewOperations(operations) : []
  };
}

const tools = [
  {
    name: "photoshop_get_bridge_status",
    description: "Return broker, Photoshop polling, snapshot freshness, and recent command lifecycle status.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "photoshop_get_layer_tree",
    description: "Request and return a fresh Photoshop layer tree. Loads only two hierarchy levels by default; raise maxDepth or set full=true only when deeper data is needed.",
    inputSchema: {
      type: "object",
      properties: {
        maxDepth: {
          type: "integer",
          minimum: 0,
          maximum: 12,
          description: "Deepest hierarchy level to load, where 0 returns only top-level layers. Defaults to 1."
        },
        full: {
          type: "boolean",
          description: "Load the complete layer tree. This can be slow for very large PSD files."
        },
        refresh: {
          type: "boolean",
          description: "Request a new Photoshop snapshot. Defaults to true; set false only to reuse an existing cached snapshot."
        }
      }
    }
  },
  {
    name: "photoshop_get_layer_state_summary",
    description: "Return coverage statistics for the latest Photoshop layer snapshot, including descriptor success, failure, and missing counts.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "photoshop_get_snapshot_history",
    description: "Return summaries of recent Photoshop layer snapshots received by the bridge.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "photoshop_get_latest_layer_diff",
    description: "Return the layer changes between the two most recent Photoshop snapshots.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "photoshop_preview_layer_operations",
    description: "Validate and preview Photoshop layer operations against the latest layer snapshot without queueing them.",
    inputSchema: {
      type: "object",
      properties: {
        operations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              op: { type: "string", enum: ["renameLayer", "setVisibility", "createGroup", "moveLayerToGroup", "moveLayerBefore", "mergeGroupToLayer", "deleteLayer", "setLayerColor", "rasterizeLayer", "saveDocument"] },
              layerId: { type: "number" },
              groupLayerId: { type: "number" },
              groupAlias: { type: "string" },
              beforeLayerId: { type: "number" },
              name: { type: "string" },
              visible: { type: "boolean" },
              color: { type: "string" },
              parentLayerId: { type: "number" },
              assignAlias: { type: "string" }
            },
            required: ["op"]
          }
        }
      },
      required: ["operations"]
    }
  },
  {
    name: "photoshop_queue_layer_operations",
    description: "Queue explicit Photoshop layer operations for the Photoshop extension to execute.",
    inputSchema: {
      type: "object",
      properties: {
        expectedSnapshotId: {type:"string"},
        expectedDocumentId: {type:"number"},
        expectedDocumentTitle: {type:"string"},
        operations: {
          type: "array",
          description: "Layer operations to apply in Photoshop.",
          items: {
            type: "object",
            properties: {
              op: { type: "string", enum: ["renameLayer", "setVisibility", "createGroup", "moveLayerToGroup", "moveLayerBefore", "mergeGroupToLayer", "deleteLayer", "setLayerColor", "rasterizeLayer", "saveDocument"] },
              layerId: { type: "number" },
              groupLayerId: { type: "number" },
              groupAlias: { type: "string" },
              beforeLayerId: { type: "number" },
              name: { type: "string" },
              visible: { type: "boolean" },
              color: { type: "string" },
              parentLayerId: { type: "number" },
              assignAlias: { type: "string" }
            },
            required: ["op"]
          }
        },
        reason: {
          type: "string",
          description: "Short human-readable reason for the queued operation."
        }
      },
      required: ["operations","expectedSnapshotId","expectedDocumentId","expectedDocumentTitle"]
    }
  },
  {
    name: "photoshop_build_tree_order_rename_plan",
    description: "Build a deterministic tree-order layer rename plan from the latest Photoshop layer snapshot. Optionally queue it.",
    inputSchema: {
      type: "object",
      properties: {
        prefix: { type: "string" },
        separator: { type: "string" },
        startAt: { type: "number" },
        pad: { type: "number" },
        includeGroups: { type: "boolean" },
        preserveOriginalName: { type: "boolean" },
        queue: { type: "boolean" },
        reason: { type: "string" }
      }
    }
  },
  {
    name: "photoshop_build_prefix_grouping_plan",
    description: "Build a conservative grouping plan by layer-name prefix, creating groups and moving matching layers with command-local aliases. Optionally queue it.",
    inputSchema: {
      type: "object",
      properties: {
        delimiter: { type: "string" },
        minGroupSize: { type: "number" },
        groupNamePrefix: { type: "string" },
        includeGroups: { type: "boolean" },
        queue: { type: "boolean" },
        reason: { type: "string" }
      }
    }
  },
  {
    name: "photoshop_get_command_results",
    description: "Return recent Photoshop command execution results.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "photoshop_cancel_pending_command",
    description: "Cancel a queued Photoshop command before it has been delivered to the Photoshop panel.",
    inputSchema: {
      type: "object",
      properties: {
        commandId: { type: "string" },
        reason: { type: "string" }
      },
      required: ["commandId"]
    }
  }
];

async function callTool(name, args) {
  if (name === "photoshop_get_bridge_status") {
    return toolResult(buildBridgeStatus());
  }

  if (name === "photoshop_get_layer_tree") {
    const snapshot = args?.refresh === false && latestSnapshot
      ? latestSnapshot
      : await requestFreshSnapshot(args || {}, "Codex requested the layer tree");
    const layersById = flattenSnapshotLayers(snapshot);
    return toolResult({
      connected: true,
      layerCount: layersById.size,
      partial: snapshot.scope?.maxDepth !== null,
      scope: snapshot.scope || normalizeSnapshotScope(args || {}),
      snapshot
    });
  }

  if (name === "photoshop_get_layer_state_summary") {
    return toolResult(buildLayerStateSummary());
  }

  if (name === "photoshop_get_snapshot_history") {
    return toolResult({
      snapshots: snapshotHistory.map(snapshotSummary)
    });
  }

  if (name === "photoshop_get_latest_layer_diff") {
    return toolResult({
      diff: latestLayerDiff()
    });
  }

  if (name === "photoshop_preview_layer_operations") {
    const operations = normalizeOperations(args?.operations);
    if(args?.expectedSnapshotId) assertSnapshotGuard(latestSnapshot,args);
    return toolResult({
      ok: true,
      snapshotId: latestSnapshot.snapshotId,
      document: latestSnapshot.document || null,
      preview: previewOperations(operations)
    });
  }

  if (name === "photoshop_queue_layer_operations") {
    const operations = normalizeOperations(args?.operations);
    return toolResult(queueLayerOperations(operations, args?.reason || "", args));
  }

  if (name === "photoshop_build_tree_order_rename_plan") {
    const plan = buildTreeOrderRenamePlan(args || {});
    if (args?.queue) {
      return toolResult({
        ...plan,
        queued: plan.operations.length
          ? queueLayerOperations(plan.operations, args?.reason || "tree-order rename plan", snapshotGuard(latestSnapshot))
          : null
      });
    }
    return toolResult(plan);
  }

  if (name === "photoshop_build_prefix_grouping_plan") {
    const plan = buildPrefixGroupingPlan(args || {});
    if (args?.queue) {
      return toolResult({
        ...plan,
        queued: plan.operations.length
          ? queueLayerOperations(plan.operations, args?.reason || "prefix grouping plan", snapshotGuard(latestSnapshot))
          : null
      });
    }
    return toolResult(plan);
  }

  if (name === "photoshop_get_command_results") {
    return toolResult({ results: commandResults });
  }

  if (name === "photoshop_cancel_pending_command") {
    if (!args?.commandId) throw new Error("commandId is required");
    return toolResult(cancelPendingCommand(args.commandId, args.reason || ""));
  }

  throw new Error(`Unknown tool: ${name}`);
}

function sendRpc(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function sendRpcError(id, error) {
  process.stdout.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32000,
      message: error.message
    }
  })}\n`);
}

async function handleRpc(message) {
  if (!message || typeof message !== "object") return;

  if (message.method === "initialize") {
    sendRpc(message.id, {
      protocolVersion: message.params?.protocolVersion || "2024-11-05",
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: "photoshop-codex-bridge",
        version: "1.2.0"
      },
      instructions: "Use get_layer_tree first. Queue Photoshop edits only as explicit structured operations, and summarize pending changes for user confirmation before destructive edits."
    });
    return;
  }

  if (message.method === "tools/list") {
    sendRpc(message.id, { tools });
    return;
  }

  if (message.method === "tools/call") {
    try {
      const result = await callTool(message.params?.name, message.params?.arguments || {});
      sendRpc(message.id, result);
    } catch (error) {
      sendRpcError(message.id, error);
    }
    return;
  }

  if (message.id !== undefined) {
    sendRpcError(message.id, new Error(`Unsupported method: ${message.method}`));
  }
}

function startStdioRpc() {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
      if (!line) continue;
      try {
        handleRpc(JSON.parse(line));
      } catch (error) {
        sendRpcError(null, error);
      }
    }
  });
}

startBroker();
startStdioRpc();
