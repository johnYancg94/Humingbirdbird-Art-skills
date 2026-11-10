(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CodexBridgeCommandPolicy = api;
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function reject(reason) {
    return { ok: false, reason: reason };
  }

  function validateForAutomaticExecution(command, context) {
    var payload = command && command.payload;
    var operations = payload && payload.operations;
    var preview = payload && payload.preview;

    if (!command || !command.id) return reject("Command id is missing");
    if (command.type !== "layerOperations") return reject("Unsupported command type: " + command.type);
    if (!payload) return reject("Command payload is missing");
    if (!Array.isArray(operations) || operations.length === 0) return reject("Command has no layer operations");
    if (!Array.isArray(preview) || preview.length !== operations.length) return reject("Command preview does not match its operations");
    if (!payload.expectedSnapshotId) return reject("Command snapshot id is missing");
    if (!context || !context.snapshotId) return reject("Photoshop panel has no verified snapshot");
    if (payload.expectedSnapshotId !== context.snapshotId) return reject("Command snapshot does not match the panel snapshot");
    if (payload.expectedDocumentId !== null && payload.expectedDocumentId !== undefined) {
      if (context.documentId === null || context.documentId === undefined) return reject("Photoshop panel has no verified document");
      if (Number(payload.expectedDocumentId) !== Number(context.documentId)) return reject("Command document does not match the panel document");
    } else if (payload.expectedDocumentTitle && payload.expectedDocumentTitle !== context.documentTitle) {
      return reject("Command document title does not match the panel document");
    }
    return { ok: true };
  }

  return { validateForAutomaticExecution: validateForAutomaticExecution };
}));