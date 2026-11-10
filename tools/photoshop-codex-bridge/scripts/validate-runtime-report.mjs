import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

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

const reportPath = args.get("report") || process.argv[2];
if (!reportPath || String(reportPath).startsWith("--")) {
  throw new Error("Usage: node validate-runtime-report.mjs --report <path> [--require-rename] [--require-grouping] [--require-descriptors] [--require-realtime] [--expect-timeout]");
}

const requireRename = Boolean(args.get("require-rename"));
const requireGrouping = Boolean(args.get("require-grouping"));
const requireDescriptors = Boolean(args.get("require-descriptors"));
const requireRealtime = Boolean(args.get("require-realtime"));
const expectTimeout = Boolean(args.get("expect-timeout"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateTimeoutReport(report) {
  assert(report.ok === false, "timeout report must have ok=false");
  assert(report.timedOut === true, "timeout report must have timedOut=true");
  assert(report.status?.ok === true, "timeout report must include broker health");
  assert(report.requirement, "timeout report must include readiness requirements");
}

function validateReadEvidence(report) {
  assert(report.ok === true, "runtime report must have ok=true");
  assert(report.status?.photoshop?.hasSnapshot === true, "runtime report must include a Photoshop snapshot");
  assert(report.status?.photoshop?.snapshotId, "runtime report must include snapshotId");
  assert(report.status?.photoshop?.latestClientStatus?.polling === true, "Photoshop panel must be polling");
  assert(report.status?.photoshop?.latestClientStatus?.hasDocument === true, "Photoshop must have an active document");
  assert(Number(report.status?.photoshop?.latestClientStatus?.layerCount || 0) > 0, "Photoshop snapshot must include layers");
  assert(report.status?.photoshop?.latestClientStatus?.photoshopVersion, "runtime report must include Photoshop version");
  assert(report.status.photoshop.latestClientStatus.photoshopVersion !== "smoke", "runtime report must not be from the smoke-test runtime");
  assert(report.status.photoshop.latestClientStatus.documentTitle !== "smoke-test.psd", "runtime report must not be from smoke-test.psd");
  assert(report.finalLayerTree?.connected === true, "runtime report must include a connected finalLayerTree");
  assert(report.finalLayerTree?.snapshot?.snapshotId, "finalLayerTree must include snapshotId");
  assert(Number(report.finalLayerTree?.layerCount || 0) > 0, "finalLayerTree must include layers");
}

function validateRealtimeEvidence(report) {
  const realtime = report.realtimeEvidence;
  assert(realtime, "realtimeEvidence is required");
  assert(realtime.ok === true, "realtimeEvidence must have ok=true");
  assert(realtime.firstSnapshotId, "realtimeEvidence must include firstSnapshotId");
  assert(realtime.secondSnapshotId, "realtimeEvidence must include secondSnapshotId");
  assert(realtime.firstSnapshotId !== realtime.secondSnapshotId, "realtimeEvidence must prove distinct snapshots");
  assert(realtime.firstReceivedAt, "realtimeEvidence must include firstReceivedAt");
  assert(realtime.secondReceivedAt, "realtimeEvidence must include secondReceivedAt");
  assert(Date.parse(realtime.secondReceivedAt) >= Date.parse(realtime.firstReceivedAt), "realtimeEvidence timestamps must be ordered");
}

function flattenLayers(layers, flat = []) {
  for (const layer of layers || []) {
    flat.push(layer);
    flattenLayers(layer.layers || [], flat);
  }
  return flat;
}

function validateDescriptorEvidence(report) {
  const layers = flattenLayers(report.finalLayerTree?.snapshot?.layers || []);
  assert(layers.length > 0, "descriptor validation requires finalLayerTree layers");
  if (report.layerStateSummary) {
    const descriptor = report.layerStateSummary.layerState?.descriptor;
    assert(report.layerStateSummary.connected === true, "layerStateSummary must be connected");
    assert(report.layerStateSummary.snapshotId, "layerStateSummary must include snapshotId");
    assert(report.layerStateSummary.layerState?.totalLayers === layers.length, "layerStateSummary totalLayers must match finalLayerTree");
    assert(descriptor, "layerStateSummary must include descriptor counts");
    assert((descriptor.ok + descriptor.failed + descriptor.missing) === layers.length, "descriptor counts must cover every layer");
    assert(descriptor.missing === 0, "descriptor evidence must be present for every layer");
  }
  for (const layer of layers) {
    assert(typeof layer.id === "number", "each layer must include numeric id");
    assert(typeof layer.name === "string", `layer ${layer.id} must include name`);
    assert(layer.parentId === null || typeof layer.parentId === "number", `layer ${layer.id} must include parentId`);
    assert(typeof layer.index === "number", `layer ${layer.id} must include index`);
    assert(typeof layer.depth === "number", `layer ${layer.id} must include depth`);
    assert(Array.isArray(layer.path), `layer ${layer.id} must include path`);
    assert(typeof layer.isGroup === "boolean", `layer ${layer.id} must include isGroup`);
    assert(layer.descriptor && typeof layer.descriptor === "object", `layer ${layer.id} must include descriptor evidence`);
    assert(typeof layer.descriptor.ok === "boolean", `layer ${layer.id} descriptor must include ok`);
  }
}

function validateRenameEvidence(report) {
  const rename = report.renameVerification;
  assert(rename, "renameVerification is required");
  assert(rename.ok === true, "renameVerification must have ok=true");
  assert(rename.command?.status === "completed", "rename command must be completed");
  assert(rename.beforeLayer?.id, "renameVerification must include beforeLayer");
  assert(rename.afterState?.ok === true, "renameVerification must include successful afterState");
  assert(rename.afterState?.layer?.id === rename.beforeLayer.id, "rename afterState must reference the same layer id");
  assert(rename.afterState?.layer?.name !== rename.beforeLayer.name, "rename afterState layer name must differ from beforeLayer name");
}

function validateGroupingEvidence(report) {
  const grouping = report.groupingVerification || report.explicitGroupingVerification;
  assert(grouping, "groupingVerification is required");
  assert(grouping.ok === true, "groupingVerification must have ok=true");
  assert(grouping.command?.status === "completed", "grouping command must be completed");
  assert(grouping.afterState?.ok === true, "groupingVerification must include successful afterState");

  if (Array.isArray(grouping.afterState?.groups)) {
    assert(grouping.afterState.groups.length > 0, "grouping afterState must include groups");
    for (const group of grouping.afterState.groups) {
      assert(group.ok === true, `group ${group.expectedName} must be verified`);
      assert(group.groupLayer?.id, `group ${group.expectedName} must include groupLayer id`);
      assert(Array.isArray(group.movedLayers) && group.movedLayers.length > 0, `group ${group.expectedName} must include movedLayers`);
      for (const layer of group.movedLayers) {
        assert(layer?.parentId === group.groupLayer.id, `moved layer ${layer?.id} must have parentId ${group.groupLayer.id}`);
      }
    }
    return;
  }

  assert(grouping.afterState?.groupLayer?.id, "explicit grouping afterState must include groupLayer id");
  assert(Array.isArray(grouping.afterState?.movedLayers) && grouping.afterState.movedLayers.length > 0, "explicit grouping afterState must include movedLayers");
  for (const layer of grouping.afterState.movedLayers) {
    assert(layer?.parentId === grouping.afterState.groupLayer.id, `moved layer ${layer?.id} must have parentId ${grouping.afterState.groupLayer.id}`);
  }
}

const report = JSON.parse(await readFile(resolve(reportPath), "utf8"));

if (expectTimeout) {
  validateTimeoutReport(report);
  console.log("runtime timeout report valid");
  process.exit(0);
}

validateReadEvidence(report);
if (requireRename) validateRenameEvidence(report);
if (requireGrouping) validateGroupingEvidence(report);
if (requireDescriptors) validateDescriptorEvidence(report);
if (requireRealtime) validateRealtimeEvidence(report);

console.log("runtime report valid");
