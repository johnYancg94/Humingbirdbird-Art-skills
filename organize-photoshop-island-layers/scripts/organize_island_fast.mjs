import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const DEFAULT_API = "http://127.0.0.1:47777";
const ROOT_ORDER = ["地表前层", "破损前层", "完整前层", "建筑", "背景"];
const STATE_RULES = new Map([
  ["修复后", { suffix: "", target: "region" }],
  ["破损", { suffix: "ruin", target: "region" }],
  ["修复后前层", { suffix: "front01", target: "完整前层" }],
  ["破损前层", { suffix: "ruin_front01", target: "破损前层" }]
]);

function parseArgs(argv) {
  const options = { api: DEFAULT_API, timeoutMs: 300000, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") options.config = argv[++i];
    else if (arg === "--api") options.api = argv[++i];
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++i]);
    else if (arg === "--dry-run") options.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.config) throw new Error("--config is required");
  return options;
}

async function requestJson(api, pathname, options = {}, timeoutMs = 60000) {
  const response = await fetch(`${api}${pathname}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    signal: AbortSignal.timeout(timeoutMs)
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body.error || `${pathname} failed with HTTP ${response.status}`);
  return body;
}

async function freshSnapshot(api, reason, timeoutMs) {
  const response = await requestJson(api, "/codex/snapshot/request", {
    method: "POST",
    body: JSON.stringify({ maxDepth: null, reason })
  }, timeoutMs);
  return response.snapshot;
}

function flatten(layers, output = []) {
  for (const layer of layers || []) {
    output.push(layer);
    flatten(layer.layers, output);
  }
  return output;
}

function directChild(parent, name, required = true) {
  const matches = (parent.layers || []).filter(layer => layer.name === name);
  if (matches.length > 1) throw new Error(`Duplicate child ${name} under ${parent.name}`);
  if (required && matches.length !== 1) throw new Error(`Missing child ${name} under ${parent.name}`);
  return matches[0] || null;
}

function rootLayer(snapshot, name, required = true) {
  const matches = (snapshot.layers || []).filter(layer => layer.name === name);
  if (matches.length > 1) throw new Error(`Duplicate root layer: ${name}`);
  if (required && matches.length !== 1) throw new Error(`Missing root layer: ${name}`);
  return matches[0] || null;
}

function validateConfig(config) {
  if (!config || typeof config !== "object") throw new Error("Config must be an object");
  if (!/^[a-z0-9]+$/.test(config.slug || "")) throw new Error("Config slug must contain only lowercase ASCII letters and digits");
  if (!config.documentTitle) throw new Error("Config documentTitle is required");
  if (config.allowMergeAllRootBackgroundLayers !== true) throw new Error("Config must explicitly set allowMergeAllRootBackgroundLayers to true after auditing root leaf layers");
  if (!Array.isArray(config.regions) || config.regions.length !== 5) throw new Error("Config must define exactly five regions");
  const sources = new Set();
  const tokens = new Set();
  for (const region of config.regions) {
    if (!region.name || !region.color || !Array.isArray(region.buildings)) throw new Error("Each region requires name, color, and buildings");
    for (const building of region.buildings) {
      if (!building.source || !building.token) throw new Error(`Invalid building mapping in ${region.name}`);
      if (sources.has(building.source)) throw new Error(`Duplicate source building: ${building.source}`);
      if (tokens.has(building.token)) throw new Error(`Duplicate building token: ${building.token}`);
      sources.add(building.source);
      tokens.add(building.token);
    }
  }
  return { buildingCount: sources.size };
}

function assertDocument(snapshot, config) {
  if (snapshot.document?.title !== config.documentTitle) {
    throw new Error(`Active Photoshop document is ${snapshot.document?.title || "none"}; expected ${config.documentTitle}`);
  }
}

export function buildSetupOperations(snapshot, config) {
  assertDocument(snapshot, config);
  const surface = rootLayer(snapshot, "背景前层");
  for (const name of ROOT_ORDER.slice(1)) {
    if (rootLayer(snapshot, name, false)) throw new Error(`Root group ${name} already exists; use a pristine source PSD or resume from a refreshed snapshot`);
  }
  if (rootLayer(snapshot, "__codex_background_merge__", false)) throw new Error("Temporary background group already exists");

  const regionNames = new Set(config.regions.map(region => region.name));
  for (const region of config.regions) {
    const sourceRegion = rootLayer(snapshot, region.name);
    if (!sourceRegion.isGroup) throw new Error(`${region.name} is not a layer group`);
  }
  const backgroundLayers = (snapshot.layers || []).filter(layer => !layer.isGroup && !regionNames.has(layer.name));
  if (!backgroundLayers.length) throw new Error("No root background layers were found");

  const prefix = `island_${config.slug}`;
  const operations = [{ op: "renameLayer", layerId: surface.id, name: "地表前层" }];
  (surface.layers || []).forEach((layer, index) => {
    operations.push({ op: "renameLayer", layerId: layer.id, name: `${prefix}_bg_front${String(index + 1).padStart(2, "0")}` });
  });
  operations.push(
    { op: "createGroup", name: "背景", assignAlias: "background" },
    { op: "createGroup", name: "建筑", assignAlias: "buildings" },
    { op: "createGroup", name: "完整前层", assignAlias: "completeFront" },
    { op: "createGroup", name: "破损前层", assignAlias: "ruinFront" },
    { op: "createGroup", name: "__codex_background_merge__", assignAlias: "backgroundMerge" }
  );
  for (const layer of backgroundLayers) {
    operations.push({ op: "moveLayerToGroup", layerId: layer.id, groupAlias: "backgroundMerge" });
  }
  return operations;
}

export function buildOrganizeOperations(snapshot, config) {
  assertDocument(snapshot, config);
  const targets = new Map(ROOT_ORDER.map(name => [name, rootLayer(snapshot, name)]));
  const backgroundMerge = rootLayer(snapshot, "__codex_background_merge__");
  const prefix = `island_${config.slug}`;
  const operations = [
    { op: "moveLayerToGroup", layerId: backgroundMerge.id, groupLayerId: targets.get("背景").id },
    { op: "mergeGroupToLayer", groupLayerId: backgroundMerge.id, name: `${prefix}_bg` }
  ];

  for (const regionSpec of config.regions) {
    const region = rootLayer(snapshot, regionSpec.name);
    const expectedBuildings = new Set(regionSpec.buildings.map(item => item.source));
    const actualBuildingGroups = (region.layers || []).filter(layer => layer.isGroup);
    const unexpected = actualBuildingGroups.filter(layer => !expectedBuildings.has(layer.name));
    if (unexpected.length) throw new Error(`Unexpected building groups in ${region.name}: ${unexpected.map(layer => layer.name).join(", ")}`);

    for (const buildingSpec of regionSpec.buildings) {
      const building = directChild(region, buildingSpec.source);
      if (!building.isGroup) throw new Error(`${region.name}/${building.name} is not a group`);
      const stateGroups = (building.layers || []).filter(layer => layer.isGroup);
      const nonGroups = (building.layers || []).filter(layer => !layer.isGroup);
      if (nonGroups.length) throw new Error(`Unexpected direct layers in ${region.name}/${building.name}: ${nonGroups.map(layer => layer.name).join(", ")}`);
      for (const stateGroup of stateGroups) {
        const rule = STATE_RULES.get(stateGroup.name);
        if (!rule) throw new Error(`Unknown state group ${stateGroup.name} in ${region.name}/${building.name}`);
        if ((stateGroup.childCount ?? stateGroup.layers?.length ?? 0) === 0) {
          operations.push({ op: "deleteLayer", layerId: stateGroup.id });
          continue;
        }
        const finalName = rule.suffix ? `${prefix}_${buildingSpec.token}_${rule.suffix}` : `${prefix}_${buildingSpec.token}`;
        operations.push({ op: "mergeGroupToLayer", groupLayerId: stateGroup.id, name: finalName });
        const targetId = rule.target === "region" ? region.id : targets.get(rule.target).id;
        operations.push({ op: "moveLayerToGroup", layerId: stateGroup.id, groupLayerId: targetId });
      }
      operations.push({ op: "deleteLayer", layerId: building.id });
    }

    operations.push(
      { op: "moveLayerToGroup", layerId: region.id, groupLayerId: targets.get("建筑").id },
      { op: "setLayerColor", layerId: region.id, color: regionSpec.color }
    );
  }

  const bottomUp = ["建筑", "完整前层", "破损前层", "地表前层"];
  let before = targets.get("背景");
  for (const name of bottomUp) {
    const layer = targets.get(name);
    operations.push({ op: "moveLayerBefore", layerId: layer.id, beforeLayerId: before.id });
    before = layer;
  }
  operations.push({ op: "saveDocument" });
  return operations;
}

async function queueAndWait(api, operations, reason, timeoutMs, dryRun) {
  const preview = await requestJson(api, "/codex/layer-operations/preview", {
    method: "POST",
    body: JSON.stringify({ operations })
  }, timeoutMs);
  if (dryRun) return { dryRun: true, operationCount: operations.length, preview: preview.preview };
  const queued = await requestJson(api, "/codex/layer-operations/queue", {
    method: "POST",
    body: JSON.stringify({ operations, reason })
  }, timeoutMs);
  const commandId = queued.command.id;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 300));
    const status = await requestJson(api, `/codex/commands/${commandId}`, {}, 10000);
    if (status.command.status === "completed") return status.command;
    if (["failed", "cancelled"].includes(status.command.status)) {
      throw new Error(`${reason} failed: ${JSON.stringify(status.command.result)}`);
    }
  }
  throw new Error(`${reason} timed out after ${timeoutMs} ms`);
}

export function validateFinalSnapshot(snapshot, config) {
  assertDocument(snapshot, config);
  const errors = [];
  const roots = snapshot.layers || [];
  const rootNames = roots.map(layer => layer.name);
  if (JSON.stringify(rootNames) !== JSON.stringify(ROOT_ORDER)) errors.push(`Root order is ${rootNames.join(" > ")}`);
  const buildings = rootLayer(snapshot, "建筑", false);
  if (!buildings) errors.push("Missing 建筑 group");
  const expectedCount = config.regions.reduce((sum, region) => sum + region.buildings.length, 0) * 2;
  let buildingLayerCount = 0;
  if (buildings) {
    const regions = buildings.layers || [];
    if (regions.length !== 5) errors.push(`建筑 contains ${regions.length} region groups instead of 5`);
    for (const regionSpec of config.regions) {
      const region = directChild(buildings, regionSpec.name, false);
      if (!region) errors.push(`Missing ${regionSpec.name} under 建筑`);
      else {
        const leaves = (region.layers || []).filter(layer => !layer.isGroup);
        const groups = (region.layers || []).filter(layer => layer.isGroup);
        buildingLayerCount += leaves.length;
        if (groups.length) errors.push(`${region.name} still contains building groups`);
        if (leaves.length !== regionSpec.buildings.length * 2) errors.push(`${region.name} contains ${leaves.length} building layers`);
      }
    }
  }
  if (buildingLayerCount !== expectedCount) errors.push(`Building layer count is ${buildingLayerCount}; expected ${expectedCount}`);
  const all = flatten(roots);
  const smartObjects = all.filter(layer => !layer.isGroup && String(layer.kind).toUpperCase().includes("SMARTOBJECT"));
  if (smartObjects.length) errors.push(`${smartObjects.length} Smart Objects remain`);
  const prefix = `island_${config.slug}_`;
  const badNames = all.filter(layer => !layer.isGroup && !layer.name.startsWith(prefix));
  if (badNames.length) errors.push(`Nonstandard leaf names: ${badNames.map(layer => layer.name).join(", ")}`);
  const names = new Set();
  const duplicates = [];
  for (const layer of all.filter(item => !item.isGroup)) {
    if (names.has(layer.name)) duplicates.push(layer.name);
    names.add(layer.name);
  }
  if (duplicates.length) errors.push(`Duplicate leaf names: ${[...new Set(duplicates)].join(", ")}`);
  return {
    ok: errors.length === 0,
    errors,
    rootOrder: rootNames,
    totalLayers: all.length,
    buildingLayerCount,
    smartObjectCount: smartObjects.length,
    colorObservability: snapshot.capabilities?.colorLabels || "unknown"
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = JSON.parse(await readFile(options.config, "utf8"));
  const configSummary = validateConfig(config);
  const startedAt = Date.now();
  console.log(JSON.stringify({ event: "start", documentTitle: config.documentTitle, slug: config.slug, ...configSummary }));

  const initial = await freshSnapshot(options.api, "fast island organizer: initial snapshot", options.timeoutMs);
  const setupOperations = buildSetupOperations(initial, config);
  console.log(JSON.stringify({ event: "setup-plan", operations: setupOperations.length }));
  await queueAndWait(options.api, setupOperations, "fast island organizer setup", options.timeoutMs, options.dryRun);
  if (options.dryRun) return;

  const prepared = await freshSnapshot(options.api, "fast island organizer: prepared snapshot", options.timeoutMs);
  const organizeOperations = buildOrganizeOperations(prepared, config);
  console.log(JSON.stringify({ event: "organize-plan", operations: organizeOperations.length }));
  await queueAndWait(options.api, organizeOperations, "fast island organizer main batch", options.timeoutMs, false);

  const finalSnapshot = await freshSnapshot(options.api, "fast island organizer: final validation", options.timeoutMs);
  const validation = validateFinalSnapshot(finalSnapshot, config);
  const elapsedMs = Date.now() - startedAt;
  console.log(JSON.stringify({ event: "complete", elapsedMs, elapsedSeconds: Number((elapsedMs / 1000).toFixed(1)), validation }));
  if (!validation.ok) process.exitCode = 2;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(error => {
    console.error(JSON.stringify({ event: "error", error: error.message }));
    process.exitCode = 1;
  });
}