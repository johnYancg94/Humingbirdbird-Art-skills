import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {validateDelivery, REGION_COLORS, flatten as flattenTree} from "./layer-validation.mjs";

const DEFAULT_API = "http://127.0.0.1:47777";
const ROOT_ORDER = ["地表前层", "破损前层", "完整前层", "建筑", "背景"];
const STATE_RULES = new Map([
  ["修复后", { suffix: "", target: "region" }],
  ["破损", { suffix: "ruin", target: "region" }],
  ["修复后前层", { suffix: "front01", target: "完整前层" }],
  ["破损前层", { suffix: "ruin_front01", target: "破损前层" }]
]);

function parseArgs(argv) {
  const options = { api: DEFAULT_API, timeoutMs: 600000, dryRun: false, report: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") options.config = argv[++i];
    else if (arg === "--api") options.api = argv[++i];
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++i]);
    else if (arg === "--report") options.report = argv[++i];
    else if (arg === "--dry-run") options.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.config) throw new Error("--config is required");
  return options;
}

async function requestJson(api, pathname, options = {}, timeoutMs = 60000) {
  const response = await fetch(`${api}${pathname}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    signal: AbortSignal.timeout(timeoutMs)
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body.error || `${pathname} failed with HTTP ${response.status}`);
  return body;
}

async function freshSnapshot(api, reason, timeoutMs) {
  const response = await requestJson(api, "/codex/snapshot/request", {
    method: "POST",
    body: JSON.stringify({ maxDepth: null, reason })
  }, timeoutMs);
  return response.snapshot;
}

function flatten(layers, output = []) {
  for (const layer of layers || []) {
    output.push(layer);
    flatten(layer.layers, output);
  }
  return output;
}

function directChild(parent, name, required = true) {
  const matches = (parent.layers || []).filter(layer => layer.name === name);
  if (matches.length > 1) throw new Error(`Duplicate child ${name} under ${parent.name}`);
  if (required && matches.length !== 1) throw new Error(`Missing child ${name} under ${parent.name}`);
  return matches[0] || null;
}

function rootLayer(snapshot, name, required = true) {
  const matches = (snapshot.layers || []).filter(layer => layer.name === name);
  if (matches.length > 1) throw new Error(`Duplicate root layer: ${name}`);
  if (required && matches.length !== 1) throw new Error(`Missing root layer: ${name}`);
  return matches[0] || null;
}

function rootGroup(snapshot, name, required = true) {
  const matches = (snapshot.layers || []).filter(layer => layer.name === name && layer.isGroup);
  if (matches.length > 1) throw new Error(`Duplicate root group: ${name}`);
  if (required && matches.length !== 1) throw new Error(`Missing root group: ${name}`);
  return matches[0] || null;
}

function validateConfig(config) {
  if (!config || typeof config !== "object") throw new Error("Config must be an object");
  if (!/^[a-z0-9]+$/.test(config.slug || "")) throw new Error("Config slug must contain only lowercase ASCII letters and digits");
  if (!config.documentTitle) throw new Error("Config documentTitle is required");
  if (config.allowMergeAllRootBackgroundLayers !== true) throw new Error("Config must explicitly set allowMergeAllRootBackgroundLayers to true after auditing root leaf layers");
  if (!Array.isArray(config.regions) || config.regions.length !== 5) throw new Error("Config must define exactly five regions");
  if (new Set(config.regions.map(r=>r.name)).size !== 5) throw new Error("Duplicate regions");
  const sources = new Set();
  const tokens = new Set();
  for (const region of config.regions) {
    if (REGION_COLORS[region.name] !== region.color || !Array.isArray(region.buildings)) throw new Error("Each region requires name, color, and buildings");
    for (const building of region.buildings) {
      if (!building.source || !/^[a-z0-9]+$/.test(building.token || "")) throw new Error(`Invalid building mapping in ${region.name}`);
      if (sources.has(building.source)) throw new Error(`Duplicate source building: ${building.source}`);
      if (tokens.has(building.token)) throw new Error(`Duplicate building token: ${building.token}`);
      sources.add(building.source);
      tokens.add(building.token);
    }
  }
  return { buildingCount: sources.size };
}

function assertDocument(snapshot, config) {
  if ((config.documentId !== undefined && snapshot.document?.id !== config.documentId) || snapshot.document?.title !== config.documentTitle) {
    throw new Error(`Active Photoshop document is ${snapshot.document?.title || "none"}; expected ${config.documentTitle}`);
  }
}

export function buildSetupOperations(snapshot, config) {
  assertDocument(snapshot, config);
  const surfaces = snapshot.layers.filter(l=>["背景前层","地表前层"].includes(l.name));
  if(surfaces.length!==1 || !surfaces[0].isGroup) throw new Error("Exactly one surface foreground group required");
  const surface = surfaces[0];
  for (const name of ROOT_ORDER.slice(1)) {
    if (rootGroup(snapshot, name, false)) throw new Error(`Root group ${name} already exists; use a pristine source PSD or resume from a refreshed snapshot`);
  }
  if (rootLayer(snapshot, "__codex_background_merge__", false)) throw new Error("Temporary background group already exists");

  const regionNames = new Set(config.regions.map(region => region.name));
  for (const region of config.regions) {
    const sourceRegion = rootLayer(snapshot, region.name);
    if (!sourceRegion.isGroup) throw new Error(`${region.name} is not a layer group`);
  }
  const backgroundLayers = (snapshot.layers || []).filter(layer => !layer.isGroup && !regionNames.has(layer.name));
  if (!backgroundLayers.length) throw new Error("No root background layers were found");

  const prefix = `island_${config.slug}`;
  const operations = [{ op: "renameLayer", layerId: surface.id, name: "地表前层" }];
  (surface.layers || []).forEach((layer, index) => {
    operations.push({ op: "renameLayer", layerId: layer.id, name: `${prefix}_bg_front${String(index + 1).padStart(2, "0")}` });
  });
  operations.push(
    { op: "createGroup", name: "背景", assignAlias: "background" },
    { op: "createGroup", name: "建筑", assignAlias: "buildings" },
    { op: "createGroup", name: "完整前层", assignAlias: "completeFront" },
    { op: "createGroup", name: "破损前层", assignAlias: "ruinFront" },
    { op: "createGroup", name: "__codex_background_merge__", assignAlias: "backgroundMerge" }
  );
  for (const layer of backgroundLayers.slice().reverse()) {
    operations.push({ op: "moveLayerToGroup", layerId: layer.id, groupAlias: "backgroundMerge" });
  }
  return operations;
}

export function buildOrganizeOperations(snapshot, config) {
  assertDocument(snapshot, config);
  const targets = new Map(ROOT_ORDER.map(name => [name, rootLayer(snapshot, name)]));
  const backgroundMerge = rootLayer(snapshot, "__codex_background_merge__");
  const prefix = `island_${config.slug}`;
  const operations = [
    { op: "moveLayerToGroup", layerId: backgroundMerge.id, groupLayerId: targets.get("背景").id },
    { op: "mergeGroupToLayer", groupLayerId: backgroundMerge.id, name: `${prefix}_bg` }
  ];

  for (const regionSpec of config.regions) {
    const region = rootLayer(snapshot, regionSpec.name);
    const expectedBuildings = new Set(regionSpec.buildings.map(item => item.source));
    const actualBuildingGroups = (region.layers || []).filter(layer => layer.isGroup);
    const unexpected = actualBuildingGroups.filter(layer => !expectedBuildings.has(layer.name));
    if (unexpected.length) throw new Error(`Unexpected building groups in ${region.name}: ${unexpected.map(layer => layer.name).join(", ")}`);

    for (const buildingSpec of regionSpec.buildings.slice().reverse()) {
      const building = directChild(region, buildingSpec.source);
      if (!building.isGroup) throw new Error(`${region.name}/${building.name} is not a group`);
      const stateGroups = (building.layers || []).filter(layer => layer.isGroup);
      const nonGroups = (building.layers || []).filter(layer => !layer.isGroup);
      if (nonGroups.length) throw new Error(`Unexpected direct layers in ${region.name}/${building.name}: ${nonGroups.map(layer => layer.name).join(", ")}`);
      for (const stateGroup of stateGroups.slice().reverse()) {
        const rule = STATE_RULES.get(stateGroup.name);
        if (!rule) throw new Error(`Unknown state group ${stateGroup.name} in ${region.name}/${building.name}`);
        if ((stateGroup.childCount ?? stateGroup.layers?.length ?? 0) === 0) {
          operations.push({ op: "deleteLayer", layerId: stateGroup.id });
          continue;
        }
        const finalName = rule.suffix ? `${prefix}_${buildingSpec.token}_${rule.suffix}` : `${prefix}_${buildingSpec.token}`;
        operations.push({ op: "mergeGroupToLayer", groupLayerId: stateGroup.id, name: finalName });
        const targetId = rule.target === "region" ? region.id : targets.get(rule.target).id;
        operations.push({ op: "moveLayerToGroup", layerId: stateGroup.id, groupLayerId: targetId });
        operations.push({op:"setVisibility",layerId:stateGroup.id,visible:config.manifest.find(e=>e.name===finalName).visible});
      }
      operations.push({ op: "deleteLayer", layerId: building.id });
    }

    operations.push(
      { op: "moveLayerToGroup", layerId: region.id, groupLayerId: targets.get("建筑").id },
      { op: "setLayerColor", layerId: region.id, color: regionSpec.color }
    );
  }

  const bottomUp = ["建筑", "完整前层", "破损前层", "地表前层"];
  let before = targets.get("背景");
  for (const name of bottomUp) {
    const layer = targets.get(name);
    operations.push({ op: "moveLayerBefore", layerId: layer.id, beforeLayerId: before.id });
    before = layer;
  }

  return operations;
}

export function validateFinalSnapshot(snapshot, config) { return validateDelivery(snapshot, config); }

export function preflight(snapshot, input) {
  const config=structuredClone(input); validateConfig(config); assertDocument(snapshot,config);
  if(snapshot.scope && snapshot.scope.maxDepth!==null)throw new Error("Full snapshot required");
  config.documentId=snapshot.document.id;
  const names=new Set(config.regions.map(r=>r.name));
  const sourceRegions=snapshot.layers.filter(l=>names.has(l.name));
  if(sourceRegions.length!==5||new Set(sourceRegions.map(l=>l.name)).size!==5||sourceRegions.some(l=>!l.isGroup))throw new Error("Exactly five unique source region groups required");
  const surfaces=snapshot.layers.filter(l=>["背景前层","地表前层"].includes(l.name));
  if(surfaces.length!==1||!surfaces[0].isGroup)throw new Error("Exactly one foreground group required");
  const surface=surfaces[0], prefix=`island_${config.slug}_`, manifest=[];
  config.groupVisibility=Object.fromEntries([...sourceRegions,surface].map(l=>[l===surface?'地表前层':l.name,l.visible!==false]));
  for(const n of ROOT_ORDER.slice(1))config.groupVisibility[n]=true;
  config.regionOrder=sourceRegions.map(l=>l.name);
  if(snapshot.layers.some(l=>l.isGroup&&l!==surface&&!names.has(l.name)))throw new Error("Unexpected root group");
  for(const l of flattenTree(snapshot.layers))if(l.locked)throw new Error(`Locked layer: ${l.name}`);
  const groupsToMove=[...snapshot.layers.filter(l=>names.has(l.name)),...snapshot.layers.filter(l=>names.has(l.name)).flatMap(r=>r.layers||[])];
  for(const g of groupsToMove)if((g.opacity!=null&&g.opacity!==100)||(g.blendMode!=null&&!/^(normal|passthrough|BlendMode\.(NORMAL|PASSTHROUGH))$/i.test(g.blendMode)))throw new Error(`Unsupported group compositing: ${g.name}`);
  for(const [i,l] of (surface.layers||[]).entries()){
    if(l.isGroup)throw new Error("Nested surface foreground requires fallback");
    manifest.push({name:prefix+`bg_front${String(i+1).padStart(2,'0')}`,root:"地表前层",visible:l.visible!==false});
  }
  // Process regions bottom to top; DOM INSIDE inserts moved layers at the top.
  config.regions=snapshot.layers.filter(l=>names.has(l.name)).slice().reverse().map(r=>{
    const spec=config.regions.find(x=>x.name===r.name);
    if(!r.isGroup||(r.layers||[]).length!==spec.buildings.length)throw new Error(`Unexpected region content: ${r.name}`);
    const used=new Set();
    spec.buildings=r.layers.map(b=>{
      const mapped=spec.buildings.find(x=>x.source===b.name);
      if(!mapped||!b.isGroup||used.has(b.name))throw new Error(`Unmapped/duplicate building: ${b.name}`);used.add(b.name);
      const states=new Set();
      for(const st of b.layers||[]){
        if(!st.isGroup||!STATE_RULES.has(st.name)||states.has(st.name))throw new Error(`Invalid state: ${b.name}/${st.name}`);states.add(st.name);
        if(!(st.layers||[]).length)continue;
        const rule=STATE_RULES.get(st.name), name=prefix+mapped.token+(rule.suffix?'_'+rule.suffix:'');
        manifest.push({name,...(rule.target==='region'?{region:r.name}:{root:rule.target}),visible:st.visible!==false&&b.visible!==false&&(rule.target==='region'||r.visible!==false)});
      }
      if(!(b.layers||[]).some(st=>['修复后','破损'].includes(st.name)&&(st.layers||[]).length))throw new Error(`No building state: ${b.name}`);
      return mapped;
    });return spec;
  });
  const backgrounds=snapshot.layers.filter(l=>!l.isGroup);
  if(!backgrounds.length)throw new Error("Missing background");
  manifest.push({name:prefix+'bg',root:'背景',visible:backgrounds.some(l=>l.visible!==false)});
  if(new Set(manifest.map(e=>e.name)).size!==manifest.length)throw new Error('Asset names collide; use unique tokens including the reserved background name');
  // Manifest order follows original document traversal, independent of command order.
  const sourceOrder=new Map(flattenTree(snapshot.layers).map((l,i)=>[l.id,i]));
  const assetOrder=new Map();
  for(const r of snapshot.layers.filter(l=>names.has(l.name)))for(const b of r.layers){const m=config.regions.find(x=>x.name===r.name).buildings.find(x=>x.source===b.name);for(const st of b.layers){const rule=STATE_RULES.get(st.name);assetOrder.set(prefix+m.token+(rule.suffix?'_'+rule.suffix:''),sourceOrder.get(st.id));}}
  manifest.sort((a,b)=>(assetOrder.get(a.name)??-1)-(assetOrder.get(b.name)??-1));
  config.manifest=manifest;config.requireColorEvidence=true;return config;
}

async function queueAndWait(api,snapshot,operations,reason,timeoutMs,report,persist) {
  const guard={expectedSnapshotId:snapshot.snapshotId,expectedDocumentId:snapshot.document.id,expectedDocumentTitle:snapshot.document.title};
  const preview=await requestJson(api,"/codex/layer-operations/preview",{method:"POST",body:JSON.stringify({operations,...guard})},timeoutMs);
  if(preview.snapshotId!==guard.expectedSnapshotId||preview.document.id!==guard.expectedDocumentId)throw new Error("Preview identity changed");
  const queued=await requestJson(api,"/codex/layer-operations/queue",{method:"POST",body:JSON.stringify({operations,reason,...guard})},timeoutMs);
  const entry={reason,commandId:queued.command.id,status:'queued',guard};report.commands.push(entry);await persist();
  console.log(JSON.stringify(entry));
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    await new Promise(r=>setTimeout(r,1000));
    const {command}=await requestJson(api,`/codex/commands/${entry.commandId}`,{},10000);
    entry.status=command.status;
    if(['completed','failed','cancelled'].includes(command.status)){
      entry.result=command.result;await persist();
      if(command.status!=='completed'||command.result?.ok===false)throw new Error(`${reason} failed: ${JSON.stringify(command.result)}`);
      return command.result?.results||[];
    }
  }
  entry.status='timeout-unknown';await persist();
  throw new Error(`Command ${entry.commandId} timed out; Photoshop may still be executing. Query this command before recovery; do not rerun setup.`);
}

async function main() {
  const options=parseArgs(process.argv.slice(2)), startedAt=Date.now();
  const report={version:'1.2.0',commands:[],saved:false};
  const reportPath=options.report||options.config+'.run.json';
  const persist=()=>writeFile(reportPath,JSON.stringify(report,null,2));
  try{
    const input=JSON.parse(await readFile(options.config,'utf8'));
    let snapshot=await freshSnapshot(options.api,'island organizer: initial',options.timeoutMs);
    const config=preflight(snapshot,input);report.config=config;report.initialSnapshot=snapshot;
    const setup=buildSetupOperations(snapshot,config);
    // Simulate setup so dry-run validates and shows the entire structural plan before mutation.
    const simulated=structuredClone(snapshot);const surface=simulated.layers.find(l=>['背景前层','地表前层'].includes(l.name));surface.name='地表前层';
    const bg=simulated.layers.filter(l=>!l.isGroup);simulated.layers=simulated.layers.filter(l=>l.isGroup);
    let id=-1;for(const name of ['背景','建筑','完整前层','破损前层','__codex_background_merge__'])simulated.layers.push({id:id--,name,isGroup:true,layers:name==='__codex_background_merge__'?bg:[]});
    report.plan={setup,organize:buildOrganizeOperations(simulated,config),conditional:'refresh; rasterize remaining smart objects; verify; save; refresh and verify'};await persist();
    if(options.dryRun){console.log(JSON.stringify({dryRun:true,reportPath,assets:config.manifest.length}));return;}
    await queueAndWait(options.api,snapshot,setup,'setup',options.timeoutMs,report,persist);
    snapshot=await freshSnapshot(options.api,'island organizer: prepared',options.timeoutMs);assertDocument(snapshot,config);
    config.colorEvidence=await queueAndWait(options.api,snapshot,buildOrganizeOperations(snapshot,config),'organize',options.timeoutMs,report,persist);
    snapshot=await freshSnapshot(options.api,'island organizer: organized',options.timeoutMs);assertDocument(snapshot,config);
    const smart=flattenTree(snapshot.layers).filter(l=>!l.isGroup&&String(l.kind).toUpperCase().includes('SMARTOBJECT'));
    if(smart.length){await queueAndWait(options.api,snapshot,smart.map(l=>({op:'rasterizeLayer',layerId:l.id})),'rasterize',options.timeoutMs,report,persist);snapshot=await freshSnapshot(options.api,'island organizer: rasterized',options.timeoutMs);}
    report.validation=validateFinalSnapshot(snapshot,config);report.finalSnapshot=snapshot;await persist();
    if(!report.validation.ok)throw new Error(JSON.stringify(report.validation.errors));
    await queueAndWait(options.api,snapshot,[{op:'saveDocument'}],'save validated document',options.timeoutMs,report,persist);report.saved=true;
    snapshot=await freshSnapshot(options.api,'island organizer: saved verification',options.timeoutMs);
    report.validation=validateFinalSnapshot(snapshot,config);report.finalSnapshot=snapshot;
    if(!report.validation.ok)throw new Error(JSON.stringify(report.validation.errors));
    report.elapsedSeconds=(Date.now()-startedAt)/1000;await persist();
    console.log(JSON.stringify({saved:true,reportPath,validation:report.validation,elapsedSeconds:report.elapsedSeconds}));
  }catch(error){report.error=error.message;await persist();throw error;}
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(error => {
    console.error(JSON.stringify({ event: "error", error: error.message }));
    process.exitCode = 1;
  });
}
