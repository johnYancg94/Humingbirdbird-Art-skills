#target photoshop

(function () {
  if (typeof JSON === "undefined") {
    JSON = {};
  }

  if (typeof JSON.stringify !== "function") {
    JSON.stringify = function (value) {
      function quote(text) {
        return '"' + String(text)
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"')
          .replace(/\r/g, "\\r")
          .replace(/\n/g, "\\n")
          .replace(/\t/g, "\\t")
          .replace(/\f/g, "\\f")
          .replace(/\x08/g, "\\b") + '"';
      }
      function encode(item) {
        if (item === null) return "null";
        var type = typeof item;
        if (type === "string") return quote(item);
        if (type === "number") return isFinite(item) ? String(item) : "null";
        if (type === "boolean") return item ? "true" : "false";
        if (item instanceof Array) {
          var arrayParts = [];
          for (var i = 0; i < item.length; i += 1) arrayParts.push(encode(item[i]));
          return "[" + arrayParts.join(",") + "]";
        }
        if (type === "object") {
          var objectParts = [];
          for (var key in item) {
            if (item.hasOwnProperty(key) && typeof item[key] !== "undefined" && typeof item[key] !== "function") {
              objectParts.push(quote(key) + ":" + encode(item[key]));
            }
          }
          return "{" + objectParts.join(",") + "}";
        }
        return "null";
      }
      return encode(value);
    };
  }

  if (typeof JSON.parse !== "function") {
    JSON.parse = function (text) {
      var source = String(text);
      if (!/^[\],:{}\s]*$/.test(source
        .replace(/\\["\\\/bfnrtu]/g, "@")
        .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, "]")
        .replace(/(?:^|:|,)(?:\s*\[)+/g, ""))) {
        throw new Error("Invalid JSON");
      }
      return eval("(" + source + ")");
    };
  }

  function errorJson(error) {
    return JSON.stringify({ __bridgeError: error && error.message ? error.message : String(error) });
  }

  function optional(read, fallback) {
    try {
      var value = read();
      return value === undefined ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  function pixels(value) {
    return optional(function () { return value.as("px"); }, Number(value));
  }

  function isoNow() {
    var date = new Date();
    function pad(value, width) {
      var text = String(value);
      while (text.length < width) text = "0" + text;
      return text;
    }
    return date.getUTCFullYear() + "-" + pad(date.getUTCMonth() + 1, 2) + "-" +
      pad(date.getUTCDate(), 2) + "T" + pad(date.getUTCHours(), 2) + ":" +
      pad(date.getUTCMinutes(), 2) + ":" + pad(date.getUTCSeconds(), 2) + "." +
      pad(date.getUTCMilliseconds(), 3) + "Z";
  }

  function layerKind(layer) {
    if (layer.typename === "LayerSet") return "group";
    return optional(function () { return String(layer.kind); }, "unknown");
  }

  function normalizeSnapshotOptions(encodedOptions) {
    var options = {};
    if (encodedOptions) {
      options = JSON.parse(decodeURIComponent(encodedOptions));
    }
    var maxDepth = 1;
    if (options.maxDepth === null || options.full === true) {
      maxDepth = null;
    } else if (typeof options.maxDepth === "number") {
      maxDepth = Math.max(0, Math.min(Math.floor(options.maxDepth), 12));
    }
    return {
      maxDepth: maxDepth
    };
  }

  function layerToJson(layer, path, parentId, index, depth, maxDepth) {
    var currentPath = path.slice(0);
    currentPath.push(layer.name);
    var isGroup = layer.typename === "LayerSet";
    var item = {
      id: layer.id,
      parentId: parentId,
      index: index,
      depth: depth,
      name: layer.name,
      kind: layerKind(layer),
      isGroup: isGroup,
      visible: layer.visible,
      color: layer.color,
      locked: false,
      opacity: null,
      blendMode: null,
      bounds: null,
      path: currentPath,
      childCount: isGroup ? layer.layers.length : 0
    };
    if (isGroup && layer.layers.length && (maxDepth === null || depth < maxDepth)) {
      item.layers = [];
      for (var i = 0; i < layer.layers.length; i += 1) {
        item.layers.push(layerToJson(layer.layers[i], currentPath, layer.id, i, depth + 1, maxDepth));
      }
    }
    return item;
  }

  function getDocumentProperty(propertyName) {
    var reference = new ActionReference();
    var propertyKey = stringIDToTypeID(propertyName);
    reference.putProperty(stringIDToTypeID("property"), propertyKey);
    reference.putEnumerated(
      stringIDToTypeID("document"),
      stringIDToTypeID("ordinal"),
      stringIDToTypeID("targetEnum")
    );
    return {
      descriptor: executeActionGet(reference),
      key: propertyKey
    };
  }

  function descriptorString(descriptor, keyName, fallback) {
    return optional(function () {
      var key = stringIDToTypeID(keyName);
      return descriptor.hasKey(key) ? descriptor.getString(key) : fallback;
    }, fallback);
  }

  function descriptorInteger(descriptor, keyName, fallback) {
    return optional(function () {
      var key = stringIDToTypeID(keyName);
      return descriptor.hasKey(key) ? descriptor.getInteger(key) : fallback;
    }, fallback);
  }

  function descriptorBoolean(descriptor, keyName, fallback) {
    return optional(function () {
      var key = stringIDToTypeID(keyName);
      return descriptor.hasKey(key) ? descriptor.getBoolean(key) : fallback;
    }, fallback);
  }

  function descriptorEnum(descriptor, keyName, fallback) {
    return optional(function () {
      var key = stringIDToTypeID(keyName);
      return descriptor.hasKey(key) ? typeIDToStringID(descriptor.getEnumerationValue(key)) : fallback;
    }, fallback);
  }

  function layerKindName(value, isGroup) {
    if (isGroup) return "group";
    var names = {
      1: "pixel",
      2: "adjustment",
      3: "text",
      4: "shape",
      5: "smartObject",
      6: "video",
      7: "group",
      8: "3d",
      9: "gradient",
      10: "pattern",
      11: "solidColor",
      12: "background"
    };
    return names[value] || "artLayer";
  }

  function rawLayerFromDescriptor(descriptor) {
    var section = descriptorEnum(descriptor, "layerSection", "layerSectionContent");
    if (section === "layerSectionEnd") return { section: section };
    var isGroup = section === "layerSectionStart";
    var layerKindValue = descriptorInteger(descriptor, "layerKind", 0);
    return {
      section: section,
      id: descriptorInteger(descriptor, "layerID", null),
      name: descriptorString(descriptor, "name", "Unnamed Layer"),
      kind: layerKindName(layerKindValue, isGroup),
      isGroup: isGroup,
      visible: descriptorBoolean(descriptor, "visible", true),
      color: descriptorEnum(descriptor, "color", null),
      locked: optional(function () {
        var lockingKey = stringIDToTypeID("layerLocking");
        var protectAllKey = stringIDToTypeID("protectAll");
        if (!descriptor.hasKey(lockingKey)) return null;
        var locking = descriptor.getObjectValue(lockingKey);
        return locking.hasKey(protectAllKey) ? locking.getBoolean(protectAllKey) : null;
      }, null),
      opacity: descriptorInteger(descriptor, "opacity", null),
      blendMode: descriptorEnum(descriptor, "mode", null),
      children: []
    };
  }

  function appendRawLayer(roots, stack, layer) {
    var parent = stack.length ? stack[stack.length - 1] : null;
    if (parent) parent.children.push(layer);
    else roots.push(layer);
    if (layer.isGroup) stack.push(layer);
  }

  function getLayerDescriptors() {
    var target = new ActionReference();
    target.putEnumerated(
      stringIDToTypeID("document"),
      stringIDToTypeID("ordinal"),
      stringIDToTypeID("targetEnum")
    );

    var properties = new ActionList();
    var propertyNames = [
      "layerID",
      "name",
      "visible",
      "layerSection",
      "layerKind",
      "layerLocking",
      "opacity",
      "mode",
      "color"
    ]
    for (var i = 0; i < propertyNames.length; i += 1) {
      properties.putString(propertyNames[i]);
    }

    var range = new ActionDescriptor();
    range.putInteger(stringIDToTypeID("index"), 1);
    range.putInteger(stringIDToTypeID("count"), -1);

    var extendedReference = new ActionList();
    extendedReference.putList(properties);
    extendedReference.putObject(stringIDToTypeID("layer"), range);

    var options = new ActionDescriptor();
    options.putBoolean(stringIDToTypeID("failOnMissingProperty"), false);
    options.putBoolean(stringIDToTypeID("failOnMissingElement"), false);

    var request = new ActionDescriptor();
    request.putReference(stringIDToTypeID("null"), target);
    request.putList(stringIDToTypeID("extendedReference"), extendedReference);
    request.putObject(stringIDToTypeID("options"), stringIDToTypeID("options"), options);

    var response = executeAction(stringIDToTypeID("multiGet"), request, DialogModes.NO);
    return response.getList(stringIDToTypeID("list"));
  }

  function readLayerHierarchy() {
    var descriptors = getLayerDescriptors();
    var roots = [];
    var stack = [];
    for (var index = descriptors.count - 1; index >= 0; index -= 1) {
      var layer = rawLayerFromDescriptor(descriptors.getObjectValue(index));
      if (layer.section === "layerSectionEnd") {
        if (stack.length) stack.pop();
      } else {
        appendRawLayer(roots, stack, layer);
      }
    }
    return roots;
  }

  function trimLayerHierarchy(layer, path, parentId, index, depth, maxDepth) {
    var currentPath = path.slice(0);
    currentPath.push(layer.name);
    var item = {
      id: layer.id,
      parentId: parentId,
      index: index,
      depth: depth,
      name: layer.name,
      kind: layer.kind,
      isGroup: layer.isGroup,
      visible: layer.visible,
      color: layer.color,
      locked: layer.locked,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      bounds: null,
      path: currentPath,
      childCount: layer.children.length
    };
    if (layer.children.length && (maxDepth === null || depth < maxDepth)) {
      item.layers = [];
      for (var i = 0; i < layer.children.length; i += 1) {
        item.layers.push(trimLayerHierarchy(layer.children[i], currentPath, layer.id, i, depth + 1, maxDepth));
      }
    }
    return item;
  }

  function fastSnapshot(options) {
    var rawLayers = readLayerHierarchy();
    var layers = [];
    for (var i = 0; i < rawLayers.length; i += 1) {
      layers.push(trimLayerHierarchy(rawLayers[i], [], null, i, 0, options.maxDepth));
    }
    var activeDocument = app.activeDocument;
    return {
      connected: true,
      runtime: "CEP",
      photoshopVersion: app.version,
      hasDocument: true,
      document: {
        id: activeDocument.id,
        title: activeDocument.name,
        width: pixels(activeDocument.width),
        height: pixels(activeDocument.height),
        descriptorMode: "action-manager-multiget"
      },
      layers: layers,
      scope: options,
      snapshotEngine: "action-manager-multiget",
      capabilities: { colorLabels: "best-effort" },
      capturedAt: isoNow()
    };
  }

  function domSnapshot(options) {
    var document = app.activeDocument;
    var layers = [];
    for (var i = 0; i < document.layers.length; i += 1) {
      layers.push(layerToJson(document.layers[i], [], null, i, 0, options.maxDepth));
    }
    return {
      connected: true,
      runtime: "CEP",
      photoshopVersion: app.version,
      hasDocument: true,
      document: {
        id: document.id,
        title: document.name,
        width: pixels(document.width),
        height: pixels(document.height),
        descriptorMode: "unavailable-cep"
      },
      layers: layers,
      scope: options,
      snapshotEngine: "dom-fallback",
      capabilities: { colorLabels: "unavailable-cep" },
      capturedAt: isoNow()
    };
  }

  function snapshot(encodedOptions) {
    try {
      var options = normalizeSnapshotOptions(encodedOptions);
      if (!app.documents.length) {
        return JSON.stringify({
          connected: true,
          runtime: "CEP",
          photoshopVersion: app.version,
          hasDocument: false,
          document: null,
          layers: [],
          scope: options,
          capabilities: { colorLabels: "unavailable-cep" },
          capturedAt: isoNow()
        });
      }
      try {
        return JSON.stringify(fastSnapshot(options));
      } catch (fastError) {
        var fallback = domSnapshot(options);
        fallback.fastSnapshotError = fastError && fastError.message ? fastError.message : String(fastError);
        return JSON.stringify(fallback);
      }
    } catch (error) {
      return errorJson(error);
    }
  }

  function status() {
    try {
      return JSON.stringify({
        connected: true,
        runtime: "CEP",
        photoshopVersion: app.version,
        hasDocument: app.documents.length > 0,
        documentTitle: app.documents.length ? app.activeDocument.name : null
      });
    } catch (error) {
      return errorJson(error);
    }
  }

  function findLayerById(layerId, layers) {
    var source = layers || (app.documents.length ? app.activeDocument.layers : []);
    for (var i = 0; i < source.length; i += 1) {
      var layer = source[i];
      if (Number(layer.id) === Number(layerId)) return layer;
      if (layer.typename === "LayerSet") {
        var child = findLayerById(layerId, layer.layers);
        if (child) return child;
      }
    }
    return null;
  }

  function requireLayer(layerId, groupOnly) {
    var layer = findLayerById(layerId);
    if (!layer) throw new Error("Layer " + layerId + " was not found");
    if (groupOnly && layer.typename !== "LayerSet") {
      throw new Error("Layer " + layerId + " is not a group");
    }
    return layer;
  }

  function selectLayer(layerId) {
    var descriptor = new ActionDescriptor();
    var reference = new ActionReference();
    reference.putIdentifier(charIDToTypeID("Lyr "), Number(layerId));
    descriptor.putReference(charIDToTypeID("null"), reference);
    descriptor.putBoolean(charIDToTypeID("MkVs"), false);
    executeAction(charIDToTypeID("slct"), descriptor, DialogModes.NO);
  }

  function setLayerColor(layerId, color) {
    var allowed = {
      none: "none",
      red: "red",
      orange: "orange",
      yellowColor: "yellowColor",
      green: "green",
      blue: "blue",
      violet: "violet",
      gray: "gray"
    };
    if (!allowed[color]) throw new Error("Unsupported layer color: " + color);
    var descriptor = new ActionDescriptor();
    var reference = new ActionReference();
    reference.putIdentifier(charIDToTypeID("Lyr "), Number(layerId));
    descriptor.putReference(charIDToTypeID("null"), reference);
    var properties = new ActionDescriptor();
    properties.putEnumerated(stringIDToTypeID("color"), stringIDToTypeID("color"), stringIDToTypeID(allowed[color]));
    descriptor.putObject(charIDToTypeID("T   "), charIDToTypeID("Lyr "), properties);
    executeAction(charIDToTypeID("setd"), descriptor, DialogModes.NO);
  }

  function moveLayerWithActionManager(layerId, targetId) {
    var descriptor = new ActionDescriptor();
    var source = new ActionReference();
    source.putIdentifier(charIDToTypeID("Lyr "), Number(layerId));
    descriptor.putReference(charIDToTypeID("null"), source);
    var target = new ActionReference();
    target.putIdentifier(charIDToTypeID("Lyr "), Number(targetId));
    descriptor.putReference(charIDToTypeID("T   "), target);
    descriptor.putBoolean(charIDToTypeID("Vrsn"), false);
    executeAction(charIDToTypeID("move"), descriptor, DialogModes.NO);
  }

  function moveLayerIntoGroupViaAnchor(layerId, targetGroupId) {
    var sourceLayer = requireLayer(layerId, false);
    var targetGroup = requireLayer(targetGroupId, true);
    var anchor = targetGroup.artLayers.add();
    anchor.name = "__ps_codex_move_anchor__";
    try {
      sourceLayer.move(anchor, ElementPlacement.PLACEBEFORE);
      var movedLayer = requireLayer(layerId, false);
      if (!movedLayer.parent || Number(movedLayer.parent.id) !== Number(targetGroupId)) {
        throw new Error("Anchor move did not place the layer inside the target group");
      }
    } finally {
      try { anchor.remove(); } catch (_) {}
    }
  }

  function rasterizeLayer(layerId) {
    selectLayer(layerId);
    var descriptor = new ActionDescriptor();
    var reference = new ActionReference();
    reference.putIdentifier(charIDToTypeID("Lyr "), Number(layerId));
    descriptor.putReference(charIDToTypeID("null"), reference);
    executeAction(stringIDToTypeID("rasterizeLayer"), descriptor, DialogModes.NO);
  }

  function layerWasMutated(mutatedLayerIds, layerId) {
    return Boolean(mutatedLayerIds[String(Number(layerId))]);
  }

  function assertPreview(operation, preview, aliases, mutatedLayerIds) {
    if (!preview) return;
    if (operation.op === "renameLayer") {
      var renameLayer = requireLayer(operation.layerId, false);
      if (!layerWasMutated(mutatedLayerIds, operation.layerId) && renameLayer.name !== preview.from) throw new Error("Layer changed before rename: " + operation.layerId);
    } else if (operation.op === "setVisibility") {
      var visibleLayer = requireLayer(operation.layerId, false);
      if (!layerWasMutated(mutatedLayerIds, operation.layerId) && Boolean(visibleLayer.visible) !== Boolean(preview.from)) throw new Error("Layer visibility changed: " + operation.layerId);
    } else if (operation.op === "moveLayerToGroup") {
      var movingLayer = requireLayer(operation.layerId, false);
      var groupId = operation.groupLayerId || aliases[operation.groupAlias];
      var targetGroup = requireLayer(groupId, true);
      if (!layerWasMutated(mutatedLayerIds, operation.layerId) && movingLayer.name !== preview.layerName) throw new Error("Layer changed before move: " + operation.layerId);
      if (!layerWasMutated(mutatedLayerIds, groupId) && preview.groupName && targetGroup.name !== preview.groupName) throw new Error("Group changed before move: " + groupId);
    } else if (operation.op === "moveLayerBefore") {
      var reorderLayer = requireLayer(operation.layerId, false);
      var beforeLayer = requireLayer(operation.beforeLayerId, false);
      if (!layerWasMutated(mutatedLayerIds, operation.layerId) && preview.layerName && reorderLayer.name !== preview.layerName) throw new Error("Layer changed before reorder: " + operation.layerId);
      if (!layerWasMutated(mutatedLayerIds, operation.beforeLayerId) && preview.beforeLayerName && beforeLayer.name !== preview.beforeLayerName) throw new Error("Reference layer changed before reorder: " + operation.beforeLayerId);
    } else if (operation.op === "createGroup" && operation.parentLayerId !== undefined && operation.parentLayerId !== null) {
      requireLayer(operation.parentLayerId, true);
    } else if (operation.op === "mergeGroupToLayer") {
      var mergeGroup = requireLayer(operation.groupLayerId, true);
      if (!layerWasMutated(mutatedLayerIds, operation.groupLayerId) && mergeGroup.name !== preview.from) throw new Error("Group changed before merge: " + operation.groupLayerId);
    } else if (operation.op === "deleteLayer" || operation.op === "setLayerColor" || operation.op === "rasterizeLayer") {
      var checkedLayer = requireLayer(operation.layerId, false);
      if (!layerWasMutated(mutatedLayerIds, operation.layerId) && checkedLayer.name !== preview.name) throw new Error("Layer changed before operation: " + operation.layerId);
    }
  }

  function applyOperation(operation, aliases) {
    if (operation.op === "renameLayer") {
      requireLayer(operation.layerId, false).name = operation.name;
      return { ok: true, op: operation.op, layerId: operation.layerId };
    }
    if (operation.op === "setVisibility") {
      requireLayer(operation.layerId, false).visible = Boolean(operation.visible);
      return { ok: true, op: operation.op, layerId: operation.layerId };
    }
    if (operation.op === "createGroup") {
      var group = app.activeDocument.layerSets.add();
      group.name = operation.name;
      if (operation.parentLayerId !== undefined && operation.parentLayerId !== null) {
        group.move(requireLayer(operation.parentLayerId, true), ElementPlacement.INSIDE);
      }
      if (operation.assignAlias) aliases[operation.assignAlias] = group.id;
      return {
        ok: true,
        op: operation.op,
        name: operation.name,
        layerId: group.id,
        assignAlias: operation.assignAlias || null,
        parentLayerId: operation.parentLayerId === undefined ? null : operation.parentLayerId
      };
    }
    if (operation.op === "moveLayerToGroup") {
      var groupLayerId = operation.groupLayerId || aliases[operation.groupAlias];
      var sourceLayer = requireLayer(operation.layerId, false);
      var targetGroup = requireLayer(groupLayerId, true);
      try {
        sourceLayer.move(targetGroup, ElementPlacement.INSIDE);
        return { ok: true, op: operation.op, layerId: operation.layerId, groupLayerId: groupLayerId, groupAlias: operation.groupAlias || null, method: "dom" };
      } catch (domError) {
        try {
          moveLayerIntoGroupViaAnchor(operation.layerId, groupLayerId);
          return { ok: true, op: operation.op, layerId: operation.layerId, groupLayerId: groupLayerId, groupAlias: operation.groupAlias || null, method: "dom-anchor" };
        } catch (anchorError) {
          try {
            moveLayerWithActionManager(operation.layerId, groupLayerId);
            return { ok: true, op: operation.op, layerId: operation.layerId, groupLayerId: groupLayerId, groupAlias: operation.groupAlias || null, method: "action-manager" };
          } catch (actionError) {
            throw new Error("Group move failed (DOM, anchor, and Action Manager): DOM=" + domError.message + "; Anchor=" + anchorError.message + "; Action Manager=" + actionError.message);
          }
        }
      }
    }
    if (operation.op === "moveLayerBefore") {
      var reorderSource = requireLayer(operation.layerId, false);
      var reorderTarget = requireLayer(operation.beforeLayerId, false);
      try {
        reorderSource.move(reorderTarget, ElementPlacement.PLACEBEFORE);
        return { ok: true, op: operation.op, layerId: operation.layerId, beforeLayerId: operation.beforeLayerId, method: "dom" };
      } catch (reorderDomError) {
        try {
          moveLayerWithActionManager(operation.layerId, operation.beforeLayerId);
          return { ok: true, op: operation.op, layerId: operation.layerId, beforeLayerId: operation.beforeLayerId, method: "action-manager" };
        } catch (reorderActionError) {
          throw new Error("Layer reorder failed (DOM and Action Manager): DOM=" + reorderDomError.message + "; Action Manager=" + reorderActionError.message);
        }
      }
    }
    if (operation.op === "mergeGroupToLayer") {
      var merged = requireLayer(operation.groupLayerId, true).merge();
      merged.name = operation.name;
      return { ok: true, op: operation.op, groupLayerId: operation.groupLayerId, layerId: merged.id, name: operation.name };
    }
    if (operation.op === "deleteLayer") {
      requireLayer(operation.layerId, false).remove();
      return { ok: true, op: operation.op, layerId: operation.layerId };
    }
    if (operation.op === "setLayerColor") {
      requireLayer(operation.layerId, false);
      setLayerColor(operation.layerId, operation.color);
      return { ok: true, op: operation.op, layerId: operation.layerId, color: operation.color };
    }
    if (operation.op === "saveDocument") {
      app.activeDocument.save();
      return { ok: true, op: operation.op, documentId: app.activeDocument.id, documentTitle: app.activeDocument.name };
    }
    if (operation.op === "rasterizeLayer") {
      requireLayer(operation.layerId, false);
      rasterizeLayer(operation.layerId);
      return { ok: true, op: operation.op, layerId: operation.layerId };
    }
    throw new Error("Unsupported operation: " + operation.op);
  }

  function execute(encodedCommand) {
    var results = [], i = -1, operations = [], idMap = {};
    try {
      var command = JSON.parse(decodeURIComponent(encodedCommand));
      if (!app.documents.length) throw new Error("No active Photoshop document");
      var document = app.activeDocument;
      var payload = command.payload || {};
      if (payload.expectedDocumentId !== null && payload.expectedDocumentId !== undefined &&
          Number(document.id) !== Number(payload.expectedDocumentId)) {
        throw new Error("Active document id does not match expected document");
      }
      if (payload.expectedDocumentTitle && document.name !== payload.expectedDocumentTitle) {
        throw new Error("Active document " + document.name + " does not match expected " + payload.expectedDocumentTitle);
      }
      var aliases = {};
      var mutatedLayerIds = {};
      results = [];
      operations = payload.operations || [];
      var previews = payload.preview || [];
      for (i = 0; i < operations.length; i += 1) {
        var original = operations[i], keys = ["layerId","groupLayerId","beforeLayerId","parentLayerId"];
        for(var k=0;k<keys.length;k++){var key=keys[k];if(idMap[String(original[key])])original[key]=idMap[String(original[key])];}
        if(previews[i]){for(var k=0;k<keys.length;k++){var key=keys[k];if(idMap[String(previews[i][key])])previews[i][key]=idMap[String(previews[i][key])];}}
        assertPreview(operations[i], previews[i], aliases, mutatedLayerIds);
        var result = applyOperation(operations[i], aliases);
        results.push(result);
        if(original.op === "mergeGroupToLayer" && result.layerId !== original.groupLayerId) idMap[String(original.groupLayerId)] = result.layerId;
        if (operations[i].layerId !== undefined && operations[i].layerId !== null) {
          mutatedLayerIds[String(Number(operations[i].layerId))] = true;
        }
        if (operations[i].groupLayerId !== undefined && operations[i].groupLayerId !== null) {
          mutatedLayerIds[String(Number(operations[i].groupLayerId))] = true;
        }
        if (result.layerId !== undefined && result.layerId !== null) {
          mutatedLayerIds[String(Number(result.layerId))] = true;
        }
      }
      return JSON.stringify({ ok: true, results: results });
    } catch (error) {
      return JSON.stringify({ ok: false, error: error && error.message ? error.message : String(error), failedOperationIndex: i, failedOperation: i >= 0 ? operations[i] : null, completedCount: results.length, results: results });
    }
  }

  $.global.psCodexBridge = {
    status: status,
    snapshot: snapshot,
    execute: execute
  };
}());
