import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=new URL('../tests/',import.meta.url);
for(const name of (await readdir(dir)).filter(n=>n.endsWith('.mjs')).sort()){
 console.log('TEST '+name);const r=spawnSync(process.execPath,[fileURLToPath(new URL(name,dir))],{stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);
}
