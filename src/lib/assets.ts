export function buildParentAssetUrl(fileName: string): string | null {
  if (!import.meta.env.DEV) {
    return null;
  }

  const root = __PARENT_ASSET_ROOT__.replace(/\\/g, "/").replace(/\/$/, "");
  const fsRoot = root.startsWith("/") ? root : `/${root}`;
  return `/@fs${fsRoot}/${fileName}`;
}

export function isEpubFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".epub");
}
