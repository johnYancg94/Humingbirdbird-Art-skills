import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("photoshop-cep/index.html", root), "utf8");
const main = await readFile(new URL("photoshop-cep/js/main.js", root), "utf8");

for (const text of ["一键开启连接", "一键关闭", "重载插件", "重新读取图层", "最近错误"]) {
  assert.ok(html.includes(text) || main.includes(text), `missing Chinese panel text: ${text}`);
}
for (const id of ["start", "stop", "reload", "refresh"]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `missing panel control: ${id}`);
}
assert.ok(main.includes("startAllConnections"));
assert.ok(main.includes("stopAllConnections"));
assert.ok(main.includes("window.location.reload()"));
assert.ok(main.includes("loadAdapterScript"));
assert.ok(main.includes("$.evalFile(new File("));
assert.ok(main.includes("await loadAdapterScript()"));
assert.ok(!/\n\s*startAllConnections\(\);\s*\n/.test(main), "panel must not connect before user action");

console.log("CEP panel localization test passed");
