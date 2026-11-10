import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';

const tmpDir = resolve(tmpdir(), "photoshop-runtime-report-validator-tests");
mkdirSync(tmpDir, { recursive: true });

function writeReport(name, report) {
  const path = resolve(tmpDir, name);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return path;
}

function runValidator(args, shouldPass = true) {
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('../scripts/validate-runtime-report.mjs',import.meta.url)),
    ...args
  ], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  if (shouldPass && result.status !== 0) {
    throw new Error(`validator failed unexpectedly:\n${result.stdout}\n${result.stderr}`);
  }
  if (!shouldPass && result.status === 0) {
    throw new Error(`validator passed unexpectedly:\n${result.stdout}\n${result.stderr}`);
  }
}

const baseSuccess = {
  ok: true,
  broker: { started: true, pid: 123 },
  verifiedAt: "2026-06-26T00:00:00.000Z",
  requirement: {
    polling: true,
    hasDocument: true,
    minLayerCount: 1,
    maxSnapshotAgeMs: 10000
  },
  status: {
    ok: true,
    photoshop: {
      hasSnapshot: true,
      snapshotId: "snapshot-a",
      latestClientStatus: {
        photoshopVersion: "27.0.0",
        polling: true,
        hasDocument: true,
        documentTitle: "runtime-check.psd",
        layerCount: 3
      }
    }
  },
  finalLayerTree: {
    connected: true,
    layerCount: 3,
    snapshot: {
      snapshotId: "snapshot-a",
      document: { id: 7, title: "runtime-check.psd" },
      layers: [
        {
          id: 1,
          parentId: null,
          index: 0,
          depth: 0,
          name: "Layer 1",
          isGroup: false,
          path: ["Layer 1"],
          descriptor: { ok: true, layerKind: 1 }
        },
        {
          id: 2,
          parentId: null,
          index: 1,
          depth: 0,
          name: "人物_head",
          isGroup: false,
          path: ["人物_head"],
          descriptor: { ok: true, layerKind: 1 }
        },
        {
          id: 3,
          parentId: null,
          index: 2,
          depth: 0,
          name: "人物_body",
          isGroup: false,
          path: ["人物_body"],
          descriptor: { ok: false, error: "descriptor read unavailable for test fixture" }
        }
      ]
    }
  },
  layerStateSummary: {
    ok: true,
    connected: true,
    snapshotId: "snapshot-a",
    document: { id: 7, title: "runtime-check.psd" },
    layerState: {
      totalLayers: 3,
      groups: 0,
      leafLayers: 3,
      hidden: 0,
      locked: 0,
      maxDepth: 0,
      withBounds: 0,
      descriptor: {
        ok: 2,
        failed: 1,
        missing: 0
      }
    }
  },
  realtimeEvidence: {
    ok: true,
    firstSnapshotId: "snapshot-a",
    secondSnapshotId: "snapshot-b",
    firstReceivedAt: "2026-06-26T00:00:00.000Z",
    secondReceivedAt: "2026-06-26T00:00:02.000Z",
    elapsedMs: 2000
  }
};

const renameAndGroupingSuccess = {
  ...baseSuccess,
  renameVerification: {
    ok: true,
    command: { id: "rename-command", status: "completed" },
    beforeLayer: { id: 1, name: "Layer 1" },
    afterState: {
      ok: true,
      snapshotId: "snapshot-b",
      layer: { id: 1, name: "Renamed Layer" }
    }
  },
  groupingVerification: {
    ok: true,
    command: { id: "group-command", status: "completed" },
    afterState: {
      ok: true,
      snapshotId: "snapshot-c",
      groups: [
        {
          ok: true,
          expectedName: "人物",
          groupLayer: { id: 10, name: "人物" },
          movedLayers: [
            { id: 2, name: "人物_head", parentId: 10 },
            { id: 3, name: "人物_body", parentId: 10 }
          ]
        }
      ]
    }
  }
};

const explicitGroupingSuccess = {
  ...baseSuccess,
  explicitGroupingVerification: {
    ok: true,
    command: { id: "explicit-group-command", status: "completed" },
    target: {
      groupName: "Codex_Runtime_Group_Test",
      layers: [
        { id: 2, name: "Layer 2" },
        { id: 3, name: "Layer 3" }
      ]
    },
    afterState: {
      ok: true,
      snapshotId: "snapshot-d",
      groupLayer: { id: 20, name: "Codex_Runtime_Group_Test" },
      movedLayers: [
        { id: 2, name: "Layer 2", parentId: 20 },
        { id: 3, name: "Layer 3", parentId: 20 }
      ]
    }
  }
};

const timeoutReport = {
  ok: false,
  timedOut: true,
  broker: { started: true, pid: 123 },
  verifiedAt: "2026-06-26T00:00:00.000Z",
  requirement: {
    polling: true,
    hasDocument: true,
    minLayerCount: 1,
    maxSnapshotAgeMs: 10000
  },
  status: {
    ok: true,
    photoshop: {
      hasSnapshot: false,
      snapshotAgeMs: null,
      latestClientStatus: null
    }
  }
};

const successPath = writeReport("success.json", renameAndGroupingSuccess);
const explicitGroupingPath = writeReport("explicit-grouping.json", explicitGroupingSuccess);
const timeoutPath = writeReport("timeout.json", timeoutReport);
const missingRenamePath = writeReport("missing-rename.json", baseSuccess);
const { realtimeEvidence: _unusedRealtimeEvidence, ...missingRealtimeReport } = baseSuccess;
const missingRealtimePath = writeReport("missing-realtime.json", missingRealtimeReport);
const smokePath = writeReport("smoke.json", {
  ...baseSuccess,
  status: {
    ok: true,
    photoshop: {
      hasSnapshot: true,
      snapshotId: "snapshot-smoke",
      latestClientStatus: {
        photoshopVersion: "smoke",
        polling: true,
        hasDocument: true,
        documentTitle: "smoke-test.psd",
        layerCount: 3
      }
    }
  }
});

runValidator(["--report", successPath]);
runValidator(["--report", successPath, "--require-rename"]);
runValidator(["--report", successPath, "--require-grouping"]);
runValidator(["--report", explicitGroupingPath, "--require-grouping"]);
runValidator(["--report", successPath, "--require-descriptors"]);
runValidator(["--report", successPath, "--require-realtime"]);
runValidator(["--report", timeoutPath, "--expect-timeout"]);
runValidator(["--report", missingRenamePath, "--require-rename"], false);
runValidator(["--report", missingRealtimePath, "--require-realtime"], false);
runValidator(["--report", smokePath], false);

console.log("runtime report validator tests passed");
