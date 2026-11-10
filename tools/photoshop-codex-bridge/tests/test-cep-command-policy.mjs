import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const policy = require("../photoshop-cep/js/command-policy.js");

function command(overrides = {}) {
  return {
    id: "command-1",
    type: "layerOperations",
    payload: {
      operations: [{ op: "renameLayer", layerId: 12, name: "Renamed" }],
      preview: [{ op: "renameLayer", layerId: 12, from: "Old", to: "Renamed" }],
      expectedSnapshotId: "snapshot-1",
      expectedDocumentId: 42,
      expectedDocumentTitle: "Island.psd",
      ...overrides
    }
  };
}

const context = { snapshotId: "snapshot-1", documentId: 42, documentTitle: "Island.psd" };
assert.deepEqual(policy.validateForAutomaticExecution(command(), context), { ok: true });
assert.equal(policy.validateForAutomaticExecution(command(), { ...context, snapshotId: "snapshot-2" }).ok, false);
assert.equal(policy.validateForAutomaticExecution(command(), { ...context, documentId: 99 }).ok, false);
assert.equal(policy.validateForAutomaticExecution(command({ preview: [] }), context).ok, false);
assert.equal(policy.validateForAutomaticExecution(command({ expectedSnapshotId: null }), context).ok, false);
console.log("CEP automatic command policy test passed");