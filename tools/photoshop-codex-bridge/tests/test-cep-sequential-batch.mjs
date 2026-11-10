import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../photoshop-cep/jsx/bridge.jsx", import.meta.url), "utf8");

assert.match(source, /function layerWasMutated\(mutatedLayerIds, layerId\)/);
assert.match(source, /assertPreview\(operations\[i\], previews\[i\], aliases, mutatedLayerIds\)/);
assert.match(source, /!layerWasMutated\(mutatedLayerIds, operation\.layerId\) && movingLayer\.name !== preview\.layerName/);
assert.match(source, /mutatedLayerIds\[String\(Number\(result\.layerId\)\)\] = true/);
assert.match(source, /operation\.op === "saveDocument"/);
assert.match(source, /app\.activeDocument\.save\(\)/);

console.log("CEP sequential batch test passed");