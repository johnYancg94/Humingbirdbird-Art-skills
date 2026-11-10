import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export const ROOT_ORDER=['地表前层','破损前层','完整前层','建筑','背景'];
export const REGION_COLORS={'区域一':'red','区域二':'orange','区域三':'yellowColor','区域四':'green','区域五':'blue'};
export const children=l=>l.layers||l.children||[];
export const flatten=ls=>ls.flatMap(l=>[l,...flatten(children(l))]);
export const kind=l=>String(l.kind??'').replace(/^LayerKind\./i,'').toLowerCase();
export const isGroup=l=>l.isGroup===true||kind(l)==='group';

export function validateDelivery(payload, config={}) {
  const s=payload.snapshot||payload, roots=s.layers||[], errors=[], notes=[];
  const slug=config.slug;
  if(!/^[a-z0-9]+$/.test(slug||'')) errors.push('Invalid island slug');
  if(config.documentId!==undefined&&s.document?.id!==config.documentId) errors.push('Document ID mismatch');
  if(config.documentTitle&&s.document?.title!==config.documentTitle) errors.push('Document title mismatch');
  if(JSON.stringify(roots.map(l=>l.name))!==JSON.stringify(ROOT_ORDER)) errors.push('Root groups/order must match the standard exactly');
  if(roots.some(l=>!isGroup(l))) errors.push('Every root must be a group');
  const all=flatten(roots), leaves=all.filter(l=>!isGroup(l));
  const smart=leaves.filter(l=>kind(l)==='smartobject');
  for(const l of leaves) if(!['normal','pixel'].includes(kind(l))) errors.push(`Nonpixel layer: ${l.name} (${l.kind})`);
  const seen=new Set();
  for(const l of leaves){if(seen.has(l.name))errors.push(`Duplicate asset: ${l.name}`);seen.add(l.name);}
  const building=roots.find(l=>l.name==='建筑'), regions=children(building||{});
  if(config.regionOrder&&JSON.stringify(regions.map(r=>r.name))!==JSON.stringify(config.regionOrder))errors.push('Region stacking order changed');
  if(config.groupVisibility)for(const [name,visible] of Object.entries(config.groupVisibility)){
    const g=[...roots,...regions].find(l=>l.name===name);
    if(!g||g.visible!==visible)errors.push(`Group visibility changed: ${name}`);
  }
  if(regions.length!==5||new Set(regions.map(l=>l.name)).size!==5)errors.push('Exactly five unique regions required');
  const prefix=`island_${slug}_`;
  const colorEvidence=config.colorEvidence||[];
  for(const [name,color] of Object.entries(REGION_COLORS)){
    const r=regions.find(l=>l.name===name);
    if(!r||!isGroup(r)){errors.push(`Missing region group: ${name}`);continue;}
    if(children(r).some(isGroup))errors.push(`Nested building groups: ${name}`);
    let actual=r.color??r.descriptor?.color;
    if(actual&&typeof actual==='object')actual=actual._value||actual.value;
    if(actual!==undefined&&actual!==null&&actual!==color)errors.push(`Wrong region color: ${name}`);
    if(!actual){
      const applied=colorEvidence.some(e=>e.ok===true&&e.op==='setLayerColor'&&e.layerId===r.id&&e.color===color);
      if(config.requireColorEvidence&&!applied)errors.push(`No color operation evidence: ${name}`);
      else notes.push(`${name}: color ${applied?'operation confirmed':'not observable in snapshot'}`);
    }
  }
  for(const r of regions) if(!(r.name in REGION_COLORS)) errors.push(`Unexpected region: ${r.name}`);
  for(const root of roots){
    if(root.name==='建筑')continue;
    if(children(root).some(isGroup))errors.push(`Nested foreground/background group: ${root.name}`);
    if(root.name==='背景'&&(children(root).length!==1||children(root)[0]?.name!==prefix+'bg'))errors.push('Exactly one named background required');
    const pattern=root.name==='地表前层'?/^bg_front\d{2}$/:root.name==='完整前层'?/^[a-z0-9]+_front\d{2}$/:root.name==='破损前层'?/^[a-z0-9]+_ruin_front\d{2}$/:/^bg$/;
    for(const l of children(root))if(!l.name.startsWith(prefix)||!pattern.test(l.name.slice(prefix.length)))errors.push(`Invalid asset name/location: ${l.name}`);
    const sequences=new Map();
    for(const l of children(root)){const m=l.name.match(/^(.*_front)(\d{2})$/);if(m){if(!sequences.has(m[1]))sequences.set(m[1],[]);sequences.get(m[1]).push(Number(m[2]));}}
    for(const [base,seq] of sequences)if(seq.sort((a,b)=>a-b).some((n,i)=>n!==i+1))errors.push(`Nonconsecutive foreground numbers: ${base}`);
  }
  for(const r of regions)for(const l of children(r))if(!l.name.startsWith(prefix)||!/^[a-z0-9]+(?:_ruin)?$/.test(l.name.slice(prefix.length)))errors.push(`Invalid building name: ${l.name}`);
  if(config.manifest){
    const expected=config.manifest;
    if(leaves.length!==expected.length)errors.push(`Asset count ${leaves.length}; expected ${expected.length}`);
    for(const e of expected){
      const parent=e.region?regions.find(r=>r.name===e.region):roots.find(r=>r.name===e.root);
      const matches=children(parent||{}).filter(l=>l.name===e.name);
      if(matches.length!==1)errors.push(`Missing or misplaced expected asset: ${e.name}`);
      else if(e.visible!==undefined&&matches[0].visible!==e.visible)errors.push(`Visibility changed: ${e.name}`);
    }
    for(const l of leaves)if(!expected.some(e=>e.name===l.name))errors.push(`Unexpected asset: ${l.name}`);
    if(config.checkOrder!==false){
      for(const parent of [...roots.filter(l=>l.name!=='建筑'),...regions]){
        const order=expected.filter(e=>e.region===parent.name||e.root===parent.name).map(e=>e.name);
        if(JSON.stringify(order)!==JSON.stringify(children(parent).map(l=>l.name)))errors.push(`Asset stacking order changed: ${parent.name}`);
      }
    }
  }else if(config.regions){
    for(const spec of config.regions){
      const r=regions.find(l=>l.name===spec.name), allowed=new Set(spec.buildings.flatMap(b=>[prefix+b.token,prefix+b.token+'_ruin']));
      for(const l of children(r||{}))if(!allowed.has(l.name))errors.push(`Unknown mapped building: ${l.name}`);
    }
    notes.push('No source manifest: missing states and foreground coverage were not verified');
  }else notes.push('Structure-only validation: provide --config with source manifest for delivery acceptance');
  return {ok:errors.length===0,errors,notes,totalLayers:all.length,buildingLayerCount:regions.reduce((n,r)=>n+children(r).length,0),smartObjectCount:smart.length,rootOrder:roots.map(l=>l.name)};
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  const args=process.argv.slice(2), file=args[0];
  const option=n=>args[args.indexOf(n)+1];
  const config=args.includes('--config')?JSON.parse(await readFile(option('--config'),'utf8')):{slug:option('--island')};
  const result=validateDelivery(JSON.parse(await readFile(file,'utf8')),config);
  console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:1;
}
