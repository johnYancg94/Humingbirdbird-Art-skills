import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

const port = await getFreePort();
const server = spawn(process.execPath, ["mcp-server/server.mjs"], {
  cwd: new URL("../", import.meta.url),
  stdio: ["pipe", "pipe", "inherit"],
  env: {
    ...process.env,
    PS_BRIDGE_PORT: String(port),
    PS_BRIDGE_SNAPSHOT_TIMEOUT_MS: "5000"
  }
});

let output = "";
server.stdout.on("data", chunk => {
  output += chunk;
});

async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, options);
  assert.equal(response.ok, true, `HTTP ${response.status} for ${path}`);
  return response.json();
}

try {
  await wait(250);

  const idle = await request("/photoshop/requests/next");
  assert.equal(idle.snapshotRequest, null, "idle panel polling must not receive snapshot work");

  server.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "photoshop_get_layer_tree",
      arguments: { maxDepth: 1 }
    }
  })}\n`);

  await wait(100);
  const pending = await request("/photoshop/requests/next");
  assert.ok(pending.snapshotRequest?.id, "get_layer_tree should create a snapshot request");
  assert.equal(pending.snapshotRequest.scope.maxDepth, 1);

  await request("/photoshop/snapshot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: pending.snapshotRequest.id,
      scope: pending.snapshotRequest.scope,
      document: { id: 7, title: "demand.psd" },
      layers: [{ id: 1, name: "Top", isGroup: true, childCount: 12 }]
    })
  });

  await wait(100);
  assert.match(output, /demand\.psd/, "MCP call should resolve with the requested snapshot");

  const after = await request("/photoshop/requests/next");
  assert.equal(after.snapshotRequest, null, "fulfilled request should leave the queue");

  const health = await request("/health");
  assert.equal(health.photoshop.pendingSnapshotRequest, null);

  const rejectedPromise = fetch(`http://127.0.0.1:${port}/codex/snapshot/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ maxDepth: 0 })
  });
  await wait(100);
  const rejectedPending = await request("/photoshop/requests/next");
  assert.ok(rejectedPending.snapshotRequest?.id, "failed snapshot should have a request id");
  await request("/photoshop/snapshot/error", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: rejectedPending.snapshotRequest.id,
      error: "adapter failed immediately"
    })
  });
  const rejectedResponse = await rejectedPromise;
  assert.equal(rejectedResponse.status, 400, "adapter error should reject without waiting for timeout");
  assert.match(await rejectedResponse.text(), /adapter failed immediately/);

  console.log("demand snapshot test passed");
} finally {
  server.kill();
}
