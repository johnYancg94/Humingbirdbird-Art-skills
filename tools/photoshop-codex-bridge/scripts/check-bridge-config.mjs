import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const bridgeRoot = resolve(workspaceRoot, "photoshop-codex-bridge");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readText(path) {
  return readFile(path, "utf8");
}

function mustExist(path, label) {
  assert(existsSync(path), `${label} missing: ${path}`);
}

const pluginJsonPath = resolve(bridgeRoot, ".codex-plugin/plugin.json");
const mcpJsonPath = resolve(bridgeRoot, ".mcp.json");
const uxpManifestPath = resolve(bridgeRoot, "photoshop-uxp/manifest.json");
const codexConfigPath = resolve(workspaceRoot, ".codex/config.toml");
const serverPath = resolve(bridgeRoot, "mcp-server/server.mjs");
const uxpMainPath = resolve(bridgeRoot, "photoshop-uxp/main.js");

for (const [path, label] of [
  [pluginJsonPath, "plugin manifest"],
  [mcpJsonPath, "plugin MCP config"],
  [uxpManifestPath, "UXP manifest"],
  [codexConfigPath, "project Codex config"],
  [serverPath, "MCP server"],
  [uxpMainPath, "UXP panel script"],
  [resolve(bridgeRoot, "scripts/wait-for-photoshop-runtime.mjs"), "runtime verifier"],
  [resolve(bridgeRoot, "scripts/validate-runtime-report.mjs"), "runtime report validator"],
  [resolve(bridgeRoot, "tests/smoke-test.mjs"), "smoke test"]
]) {
  mustExist(path, label);
}

const pluginJson = await readJson(pluginJsonPath);
assert(pluginJson.name === "photoshop-codex-bridge", "plugin name must be photoshop-codex-bridge");
assert(pluginJson.mcpServers === "./.mcp.json", "plugin must point mcpServers at ./.mcp.json");

const mcpJson = await readJson(mcpJsonPath);
const pluginServer = mcpJson.mcpServers?.["photoshop-codex-bridge"];
assert(pluginServer, ".mcp.json must define photoshop-codex-bridge server");
assert(pluginServer.command === "node", "plugin MCP server command must be node");
assert(pluginServer.args?.[0] === "./mcp-server/server.mjs", "plugin MCP server must point at ./mcp-server/server.mjs");

const uxpManifest = await readJson(uxpManifestPath);
assert(uxpManifest.host?.app === "PS", "UXP manifest host app must be PS");
assert(uxpManifest.main === "main.js", "UXP manifest main must be main.js");
assert(
  uxpManifest.requiredPermissions?.network?.domains?.includes("http://127.0.0.1:47777"),
  "UXP manifest must allow http://127.0.0.1:47777"
);

const codexConfig = await readText(codexConfigPath);
assert(codexConfig.includes("[mcp_servers.photoshop_codex_bridge]"), "project config must define photoshop_codex_bridge MCP server");
assert(codexConfig.includes("F:/imageGN/photoshop-codex-bridge/mcp-server/server.mjs"), "project config must point to the bridge server");

const serverSource = await readText(serverPath);
for (const tool of [
  "photoshop_get_bridge_status",
  "photoshop_get_layer_tree",
  "photoshop_get_layer_state_summary",
  "photoshop_get_snapshot_history",
  "photoshop_get_latest_layer_diff",
  "photoshop_preview_layer_operations",
  "photoshop_queue_layer_operations",
  "photoshop_build_tree_order_rename_plan",
  "photoshop_build_prefix_grouping_plan",
  "photoshop_get_command_results",
  "photoshop_cancel_pending_command"
]) {
  assert(serverSource.includes(tool), `MCP server must expose ${tool}`);
}

const uxpSource = await readText(uxpMainPath);
for (const required of [
  "entrypoints.setup",
  "getLayerSnapshot",
  "readLayerDescriptor",
  "pendingApprovalCommand",
  "autoApply",
  "executeCommand"
]) {
  assert(uxpSource.includes(required), `UXP panel must include ${required}`);
}

console.log("bridge config ok");
