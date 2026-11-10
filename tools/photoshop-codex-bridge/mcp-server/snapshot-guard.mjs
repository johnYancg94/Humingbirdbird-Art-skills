export function snapshotGuard(snapshot) {
  if(!snapshot?.snapshotId||snapshot.document?.id==null||!snapshot.document?.title)throw new Error('No identified snapshot available');
  return {expectedSnapshotId:snapshot.snapshotId,expectedDocumentId:snapshot.document.id,expectedDocumentTitle:snapshot.document.title};
}
export function assertSnapshotGuard(snapshot, expected) {
  const actual=snapshotGuard(snapshot);
  for(const key of Object.keys(actual))if(expected?.[key]!==actual[key])throw new Error(`Stale or missing ${key}; refresh and preview again`);
  return actual;
}
