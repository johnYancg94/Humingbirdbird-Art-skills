export * from '../../../organize-photoshop-island-layers/scripts/organize_island_fast.mjs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const r=spawnSync(process.execPath,[fileURLToPath(new URL('../../../organize-photoshop-island-layers/scripts/organize_island_fast.mjs',import.meta.url)),...process.argv.slice(2)],{stdio:'inherit'});process.exit(r.status??1);
}
