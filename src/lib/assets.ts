export type AutoBootAssetSet = {
  label: string;
  bookTitle: string;
  epubUrl: string;
  audioUrl: string | null;
  timelineUrl: string | null;
};

type AutoBootCandidate = {
  label: string;
  bookTitle: string;
  epubPath: string;
  audioPath: string | null;
  timelinePath: string | null;
};

const AUTOBOOT_CANDIDATES: AutoBootCandidate[] = [
  {
    label: "audiobook-epub-sync workspace",
    bookTitle: "The Last Question",
    epubPath: "audiobook-epub-sync/_OceanofPDF.com_The_Last_Question_-_Isaac_Asimov.epub",
    audioPath:
      "audiobook-epub-sync/The Last Question - Isaac Asimov - Read by Leonard Nimoy - Cool Psycho Facts (128k).mp3",
    timelinePath: "audiobook-epub-sync/book_timeline.json"
  },
  {
    label: "legacy workspace sample",
    bookTitle: "book",
    epubPath: "book.epub",
    audioPath: "asr_0_300s.mp3",
    timelinePath: "book_timeline.json"
  }
];

function buildPublicAssetUrl(relativePath: string): string {
  const base = import.meta.env.BASE_URL || "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return `${normalizedBase}${relativePath.replace(/^\/+/, "")}`;
}

export function buildWorkspaceAssetUrl(relativePath: string): string | null {
  if (!import.meta.env.DEV) {
    return null;
  }

  const root = __PARENT_ASSET_ROOT__.replace(/\\/g, "/").replace(/\/$/, "");
  const fsRoot = root.startsWith("/") ? root : `/${root}`;
  return `/@fs${fsRoot}/${relativePath}`;
}

async function urlExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

export async function resolveAutoBootAssetSet(): Promise<AutoBootAssetSet | null> {
  const publicEpubUrl = buildPublicAssetUrl("autoload/book.epub");
  if (await urlExists(publicEpubUrl)) {
    const publicAudioUrl = buildPublicAssetUrl("autoload/book.mp3");
    const publicTimelineUrl = buildPublicAssetUrl("autoload/book_timeline.json");

    return {
      label: "audio-ebook-site public autoload",
      bookTitle: "The Last Question",
      epubUrl: publicEpubUrl,
      audioUrl: (await urlExists(publicAudioUrl)) ? publicAudioUrl : null,
      timelineUrl: (await urlExists(publicTimelineUrl)) ? publicTimelineUrl : null
    };
  }

  for (const candidate of AUTOBOOT_CANDIDATES) {
    const epubUrl = buildWorkspaceAssetUrl(candidate.epubPath);
    if (!epubUrl || !(await urlExists(epubUrl))) {
      continue;
    }

    const audioUrl = candidate.audioPath ? buildWorkspaceAssetUrl(candidate.audioPath) : null;
    const hasAudio = audioUrl ? await urlExists(audioUrl) : false;
    const timelineUrl = candidate.timelinePath
      ? buildWorkspaceAssetUrl(candidate.timelinePath)
      : null;
    const hasTimeline = timelineUrl ? await urlExists(timelineUrl) : false;

    return {
      label: candidate.label,
      bookTitle: candidate.bookTitle,
      epubUrl,
      audioUrl: hasAudio ? audioUrl : null,
      timelineUrl: hasTimeline ? timelineUrl : null
    };
  }

  return null;
}

export function isEpubFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".epub");
}
