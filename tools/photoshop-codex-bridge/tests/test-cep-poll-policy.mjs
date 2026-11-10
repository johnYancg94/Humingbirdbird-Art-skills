import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const policy = require("../photoshop-cep/js/poll-policy.js");

const state = policy.createState();
assert.equal(policy.beginPoll(state), true, "first poll should start");
assert.equal(policy.beginPoll(state), false, "overlapping poll must be rejected");
assert.equal(state.skippedPolls, 1);

assert.equal(policy.shouldCaptureSnapshot(state, null), false, "idle polling must never capture a snapshot");
assert.equal(policy.shouldCaptureSnapshot(state, { id: "request-1" }), true, "a broker request should trigger capture");
policy.markSnapshot(state, "request-1");
assert.equal(policy.shouldCaptureSnapshot(state, { id: "request-1" }), false, "the same request must not be captured twice");
assert.equal(policy.shouldCaptureSnapshot(state, { id: "request-2" }), true, "a new request should trigger capture");

policy.endPoll(state);
assert.equal(policy.beginPoll(state), true, "poll can resume after completion");

console.log("CEP poll policy test passed");
