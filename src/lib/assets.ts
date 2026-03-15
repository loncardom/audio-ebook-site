export type TimelineOption = {
  label: string;
  timelineUrl: string;
};

export type AutoBootAssetSet = {
  label: string;
  bookTitle: string;
  epubUrl: string;
  audioUrl: string | null;
  timelineUrl: string | null;
  timelineOptions: TimelineOption[];
};

type AutoBootManifestResponse = AutoBootAssetSet | null;

function buildPublicAssetUrl(relativePath: string): string {
  const base = import.meta.env.BASE_URL || "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return `${normalizedBase}${relativePath.replace(/^\/+/, "")}`;
}

async function urlExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

async function resolveFromDevManifest(): Promise<AutoBootAssetSet | null> {
  if (!import.meta.env.DEV) {
    return null;
  }

  try {
    const response = await fetch("/__autoload_manifest");
    if (!response.ok) {
      return null;
    }

    return (await response.json()) as AutoBootManifestResponse;
  } catch {
    return null;
  }
}

async function resolveFromPublicAutoload(): Promise<AutoBootAssetSet | null> {
  const publicEpubUrl = buildPublicAssetUrl("autoload/book.epub");
  if (!(await urlExists(publicEpubUrl))) {
    return null;
  }

  const publicAudioUrl = buildPublicAssetUrl("autoload/book.mp3");
  const publicTimelineUrl = buildPublicAssetUrl("autoload/book_timeline.json");
  const hasTimeline = await urlExists(publicTimelineUrl);

  return {
    label: "audio-ebook-site public autoload",
    bookTitle: "book",
    epubUrl: publicEpubUrl,
    audioUrl: (await urlExists(publicAudioUrl)) ? publicAudioUrl : null,
    timelineUrl: hasTimeline ? publicTimelineUrl : null,
    timelineOptions: hasTimeline
      ? [
          {
            label: "book_timeline.json",
            timelineUrl: publicTimelineUrl
          }
        ]
      : []
  };
}

export async function resolveAutoBootAssetSet(): Promise<AutoBootAssetSet | null> {
  const manifestAssets = await resolveFromDevManifest();
  if (manifestAssets) {
    return manifestAssets;
  }

  return resolveFromPublicAutoload();
}

export function isEpubFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".epub");
}
