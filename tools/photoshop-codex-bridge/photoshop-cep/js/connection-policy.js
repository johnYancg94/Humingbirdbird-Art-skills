(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CodexBridgeConnectionPolicy = api;
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function createState() {
    return {
      enabled: false,
      phase: "stopped",
      generation: 0
    };
  }

  function beginStart(state) {
    if (state.phase === "connecting" || state.phase === "connected") return null;
    state.enabled = true;
    state.phase = "connecting";
    state.generation += 1;
    return state.generation;
  }

  function markConnected(state, generation) {
    if (!isCurrent(state, generation)) return false;
    state.phase = "connected";
    return true;
  }

  function markFailed(state, generation) {
    if (!isCurrent(state, generation)) return false;
    state.enabled = false;
    state.phase = "error";
    return true;
  }

  function markRetrying(state, generation) {
    if (!isCurrent(state, generation)) return false;
    state.phase = "connecting";
    return true;
  }

  function stop(state) {
    state.enabled = false;
    state.phase = "stopped";
    state.generation += 1;
    return state.generation;
  }

  function isCurrent(state, generation) {
    return Boolean(state.enabled && state.generation === generation);
  }

  return {
    createState: createState,
    beginStart: beginStart,
    markConnected: markConnected,
    markFailed: markFailed,
    markRetrying: markRetrying,
    stop: stop,
    isCurrent: isCurrent
  };
}));
