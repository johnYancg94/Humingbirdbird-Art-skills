import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const policy = require("../photoshop-cep/js/connection-policy.js");

const state = policy.createState();
assert.equal(state.phase, "stopped");
assert.equal(state.enabled, false);

const first = policy.beginStart(state);
assert.equal(first, 1);
assert.equal(policy.beginStart(state), null, "duplicate starts must be ignored");
assert.equal(policy.isCurrent(state, first), true);
assert.equal(policy.markConnected(state, first), true);
assert.equal(state.phase, "connected");
assert.equal(policy.markRetrying(state, first), true);
assert.equal(state.phase, "connecting");
assert.equal(policy.markConnected(state, first), true);

policy.stop(state);
assert.equal(state.phase, "stopped");
assert.equal(policy.isCurrent(state, first), false, "stopped work must become stale");
assert.equal(policy.markConnected(state, first), false, "stale work must not reconnect the panel");

const second = policy.beginStart(state);
assert.equal(second, 3);
assert.equal(policy.markFailed(state, second), true);
assert.equal(state.phase, "error");
assert.equal(state.enabled, false);

console.log("CEP connection policy test passed");
