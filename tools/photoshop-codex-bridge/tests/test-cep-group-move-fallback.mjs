import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  new URL("../photoshop-cep/jsx/bridge.jsx", import.meta.url),
  "utf8"
);

assert.match(source, /function moveLayerIntoGroupViaAnchor\(layerId, targetGroupId\)/);
assert.match(source, /targetGroup\.artLayers\.add\(\)/);
assert.match(source, /sourceLayer\.move\(anchor, ElementPlacement\.PLACEBEFORE\)/);
assert.match(source, /method: "dom-anchor"/);
assert.match(source, /Group move failed \(DOM, anchor, and Action Manager\)/);
assert.match(source, /reorderSource\.move\(reorderTarget, ElementPlacement\.PLACEBEFORE\)/);

console.log("CEP Photoshop 2026 group move fallback test passed");
