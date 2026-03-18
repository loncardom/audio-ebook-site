export type TimelineOption = {
  label: string;
  timelineUrl: string;
};

export type SampleBookAssetSet = {
  label: string;
  bookTitle: string;
  epubUrl: string;
  audioUrl: string | null;
  timelineUrl: string | null;
  timelineOptions: TimelineOption[];
};

type SampleManifestResponse = SampleBookAssetSet[];

export async function resolveSampleBooks(): Promise<SampleBookAssetSet[]> {
  try {
    const response = await fetch("/__sample_manifest");
    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as unknown;
    return Array.isArray(payload) ? (payload as SampleManifestResponse) : [];
  } catch {
    return [];
  }
}

export function isEpubFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".epub");
}
