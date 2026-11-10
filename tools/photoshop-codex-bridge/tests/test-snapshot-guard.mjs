import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const child=spawn(process.execPath,[new URL('../mcp-server/server.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')],{env:{...process.env,PS_BRIDGE_PORT:String(port)},stdio:['pipe','pipe','pipe']});
const req=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});return {ok:r.ok,body:await r.json()};};
try{
 for(let i=0;i<50;i++){try{await req('/health');break;}catch{await new Promise(r=>setTimeout(r,50));}}
 const snapshot={document:{id:99,title:'same.psd'},layers:[{id:1,name:'old',isGroup:false}]};
 await req('/photoshop/snapshot',snapshot);
 const ops=[{op:'renameLayer',layerId:1,name:'new'}];
 const preview=(await req('/codex/layer-operations/preview',{operations:ops})).body;
 const guard={expectedSnapshotId:preview.snapshotId,expectedDocumentId:99,expectedDocumentTitle:'same.psd'};
 assert.equal((await req('/codex/layer-operations/queue',{operations:ops})).ok,false,'missing guard rejected');
 await req('/photoshop/snapshot',{...snapshot,document:{id:100,title:'same.psd'}});
 assert.equal((await req('/codex/layer-operations/queue',{operations:ops,...guard})).ok,false,'same-title different document rejected');
 const next=(await req('/codex/layer-operations/preview',{operations:ops})).body;
 assert.equal((await req('/codex/layer-operations/queue',{operations:ops,expectedSnapshotId:next.snapshotId,expectedDocumentId:100,expectedDocumentTitle:'same.psd'})).ok,true);
 console.log('snapshot guard HTTP test passed');
}finally{child.kill();}
