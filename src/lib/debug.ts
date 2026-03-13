export function debugLog(step: string, details?: unknown) {
  if (details === undefined) {
    console.log(`[reader-sync] ${step}`);
    return;
  }

  console.log(`[reader-sync] ${step}`, details);
}
