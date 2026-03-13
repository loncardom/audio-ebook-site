export type TimelineEntry = {
  start: number;
  end: number;
  word: string;
  spoken?: string;
  spine?: number;
  cfi: string;
};

export type ParsedTimelineRef = {
  href: string | null;
  path: string | null;
  wordIndex: number | null;
};

export function normalizeHref(href?: string | null): string | null {
  if (!href) {
    return null;
  }

  return href.split("#")[0].replace(/^\/+/, "");
}

export function hrefMatches(candidate: string | null, target: string | null): boolean {
  if (!candidate || !target) {
    return false;
  }

  return candidate === target || candidate.endsWith(target) || target.endsWith(candidate);
}

export function extractHrefFromLocator(ref: string): string | null {
  const match = ref.match(/href=([^;]+)/);
  return normalizeHref(match?.[1] ?? null);
}

export function parseTimelineRef(ref: string): ParsedTimelineRef {
  const hrefMatch = ref.match(/href=([^;]+)/);
  const pathMatch = ref.match(/path=([^;]+)/);
  const wordIndexMatch = ref.match(/w=(\d+)/);

  return {
    href: normalizeHref(hrefMatch?.[1] ?? null),
    path: pathMatch?.[1]?.trim() ?? null,
    wordIndex: wordIndexMatch ? Number(wordIndexMatch[1]) : null
  };
}

export function timelineLookupKey(
  href: string | null,
  path: string | null,
  wordIndex: number | null
): string {
  return `${href ?? ""}|${path ?? ""}|${wordIndex ?? ""}`;
}

export function findTimelineIndexAtTime(
  entries: TimelineEntry[],
  currentTime: number,
  lastIndex: number | null
): number | null {
  if (!entries.length) {
    return null;
  }

  if (
    lastIndex !== null &&
    entries[lastIndex] &&
    currentTime >= entries[lastIndex].start &&
    currentTime <= entries[lastIndex].end
  ) {
    return lastIndex;
  }

  if (currentTime < entries[0].start || currentTime > entries[entries.length - 1].end) {
    return null;
  }

  let low = 0;
  let high = entries.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const entry = entries[mid];

    if (currentTime < entry.start) {
      high = mid - 1;
      continue;
    }

    if (currentTime > entry.end) {
      low = mid + 1;
      continue;
    }

    return mid;
  }

  return null;
}
