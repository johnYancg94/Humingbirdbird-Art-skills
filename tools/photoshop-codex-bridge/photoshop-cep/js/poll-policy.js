(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CodexBridgePollPolicy = api;
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function createState() {
    return {
      inFlight: false,
      lastSnapshotRequestId: null,
      skippedPolls: 0
    };
  }

  function beginPoll(state) {
    if (state.inFlight) {
      state.skippedPolls += 1;
      return false;
    }
    state.inFlight = true;
    return true;
  }

  function endPoll(state) {
    state.inFlight = false;
  }

  function shouldCaptureSnapshot(state, request) {
    return Boolean(request && request.id && request.id !== state.lastSnapshotRequestId);
  }

  function markSnapshot(state, requestId) {
    state.lastSnapshotRequestId = requestId;
  }

  return {
    createState: createState,
    beginPoll: beginPoll,
    endPoll: endPoll,
    shouldCaptureSnapshot: shouldCaptureSnapshot,
    markSnapshot: markSnapshot
  };
}));
