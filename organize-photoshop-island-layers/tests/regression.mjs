import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {preflight,buildSetupOperations,buildOrganizeOperations,validateFinalSnapshot} from '../scripts/organize_island_fast.mjs';
import {flatten,ROOT_ORDER,REGION_COLORS} from '../scripts/layer-validation.mjs';

let id=0;
const leaf=(name,kind='LayerKind.NORMAL')=>({id:++id,name,kind,isGroup:false,visible:true});
const group=(name,layers=[])=>({id:++id,name,kind:'group',isGroup:true,visible:true,layers,childCount:layers.length});
const config={slug:'testisland',documentTitle:'test.psd',allowMergeAllRootBackgroundLayers:true,regions:Object.entries(REGION_COLORS).map(([name,color],i)=>({name,color,buildings:[{source:'building'+i,token:'building'+i}]}))};
const source={document:{id:99,title:'test.psd'},snapshotId:'initial',scope:{maxDepth:null},capabilities:{colorLabels:'unavailable-cep'},layers:[group('地表前层',[leaf('a','LayerKind.SMARTOBJECT'),leaf('b')]),...config.regions.map((r,i)=>group(r.name,[group('building'+i,[...(i?[group('破损',[leaf('ruin')])]:[]),group('修复后前层',[leaf('front')]),group('修复后',[leaf('complete')])])])),leaf('bg1'),leaf('bg2')]};
function simulate(s,ops){
 const aliases={},results=[];const find=id=>flatten(s.layers).find(l=>l.id===id);
 const container=id=>{let answer;function walk(ls){if(ls.some(l=>l.id===id))answer=ls;for(const l of ls)if(l.layers)walk(l.layers);}walk(s.layers);return answer;};
 for(const o of ops){let l=find(o.layerId??o.groupLayerId),r={ok:true,...o};
  if(o.op==='renameLayer')l.name=o.name;
  else if(o.op==='createGroup'){l=group(o.name);s.layers.unshift(l);aliases[o.assignAlias]=l.id;r.layerId=l.id;}
  else if(o.op==='moveLayerToGroup'){const from=container(l.id);from.splice(from.indexOf(l),1);find(o.groupLayerId??aliases[o.groupAlias]).layers.unshift(l);}
  else if(o.op==='mergeGroupToLayer'){const visible=(l.layers||[]).some(x=>x.visible!==false);delete l.layers;l.isGroup=false;l.kind='LayerKind.NORMAL';l.name=o.name;l.visible=visible;r.layerId=l.id;}
  else if(o.op==='deleteLayer'){const from=container(l.id);from.splice(from.indexOf(l),1);}
  else if(o.op==='setVisibility')l.visible=o.visible;
  else if(o.op==='setLayerColor'){} // CEP cannot read colors; operation evidence is required.
  else if(o.op==='rasterizeLayer')l.kind='LayerKind.NORMAL';
  else if(o.op==='moveLayerBefore'){const from=container(l.id),to=container(o.beforeLayerId);from.splice(from.indexOf(l),1);to.splice(to.findIndex(x=>x.id===o.beforeLayerId),0,l);}
  else if(o.op!=='saveDocument')throw Error(o.op);
  results.push(r);
 }for(const l of flatten(s.layers))if(l.isGroup)l.childCount=l.layers.length;
 return results;
}
const c=preflight(source,config);assert.equal(c.manifest.filter(e=>e.region).length,9,'missing ruin is allowed');
const missing=structuredClone(source);missing.layers.splice(1,1);assert.throws(()=>preflight(missing,config));
const collision=structuredClone(config);collision.regions[0].buildings[0].token='bg';assert.throws(()=>preflight(source,collision));
const s=structuredClone(source);simulate(s,buildSetupOperations(s,c));const main=buildOrganizeOperations(s,c);assert.ok(!main.some(o=>o.op==='saveDocument'));
c.colorEvidence=simulate(s,main);simulate(s,flatten(s.layers).filter(l=>/SMARTOBJECT/.test(l.kind)).map(l=>({op:'rasterizeLayer',layerId:l.id})));
assert.equal(validateFinalSnapshot(s,c).ok,true,JSON.stringify(validateFinalSnapshot(s,c)));
assert.deepEqual(s.layers.map(l=>l.name),ROOT_ORDER);
const hidden=structuredClone(s);hidden.layers[3].layers[0].visible=false;assert.equal(validateFinalSnapshot(hidden,c).ok,false);
for(const change of [s=>{flatten(s.layers).find(l=>!l.isGroup).kind='LayerKind.SMARTOBJECT';},s=>{flatten(s.layers).find(l=>!l.isGroup).kind='LayerKind.TEXT';},s=>{s.layers[3].layers[0].layers[0].name='island_testisland_wrong';},s=>{s.layers[3].layers.push(structuredClone(s.layers[3].layers[0]));},s=>{s.layers[3].layers[1].layers.reverse();},s=>{s.document.id=100;}]){const copy=structuredClone(s);change(copy);assert.equal(validateFinalSnapshot(copy,c).ok,false);}
for(const change of [s=>s.layers.push(group('unexpected')),s=>s.layers[1].layers[0].layers.push(group('unknown',[leaf('x')])),s=>s.layers.push(group('背景前层')),s=>{s.layers[1].layers[0].locked=true;}]){const copy=structuredClone(source);change(copy);assert.throws(()=>preflight(copy,config));}

// Real CLI against an isolated fake Photoshop endpoint; no actual Photoshop connection.
const temp=await mkdtemp(join(tmpdir(),'island-regression-'));let state,queued,corrupt,sequence;
const server=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;const body=raw?JSON.parse(raw):{};let out={};
 if(req.url==='/codex/snapshot/request'){state.snapshotId='snap'+(++sequence);out={snapshot:structuredClone(state)};}
 else if(req.url==='/codex/layer-operations/preview'){assert.equal(body.expectedSnapshotId,state.snapshotId);out={snapshotId:state.snapshotId,document:state.document,preview:body.operations};}
 else if(req.url==='/codex/layer-operations/queue'){
  assert.equal(body.expectedSnapshotId,state.snapshotId);assert.equal(body.expectedDocumentId,99);queued.push(body);
  const results=simulate(state,body.operations);if(corrupt&&body.reason==='organize')state.layers[3].layers[0].layers[0].name='island_testisland_wrong';
  out={command:{id:String(queued.length)}};queued.at(-1).result={ok:true,results};
 }else if(req.url.startsWith('/codex/commands/'))out={command:{status:'completed',result:queued[Number(req.url.split('/').at(-1))-1].result}};
 else {res.writeHead(404);res.end();return;}
 res.setHeader('content-type','application/json');res.end(JSON.stringify(out));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
try{
 await writeFile(join(temp,'config.json'),JSON.stringify(config));
 for(const mode of ['dry-run','success','corrupt']){
  state=structuredClone(source);queued=[];sequence=0;corrupt=mode==='corrupt';
  const child=spawn(process.execPath,[new URL('../scripts/organize_island_fast.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),'--config',join(temp,'config.json'),'--api',`http://127.0.0.1:${port}`,...(mode==='dry-run'?['--dry-run']:[])],{stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);const code=await new Promise(r=>child.on('close',r));
  assert.equal(code,mode==='corrupt'?1:0,output);
  assert.equal(queued.some(b=>b.operations.some(o=>o.op==='saveDocument')),mode==='success',output);
  if(mode==='dry-run')assert.equal(queued.length,0);
  const report=JSON.parse(await readFile(join(temp,'config.json.run.json'),'utf8'));
  assert.equal(report.saved,mode==='success');
 }
}finally{await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});}
console.log('island regression passed: preflight, missing states, stacking, validators, dry-run, rasterize, save gate');
