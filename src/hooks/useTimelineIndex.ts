import { useEffect, useRef } from "react";
import { buildElementPath, wordIndexWithinElement } from "../lib/epubDom";
import { parseTimelineRef, timelineLookupKey, type TimelineEntry } from "../lib/timeline";

function normalizePathForLookup(path: string | null): string | null {
  if (!path) {
    return null;
  }

  return path.replace(/:nth-of-type\(1\)/g, "");
}

function scorePathSuffixSimilarity(livePath: string, exportedPath: string): number {
  const liveSegments = livePath.split(" > ");
  const exportedSegments = exportedPath.split(" > ");
  let score = 0;
  let liveIndex = liveSegments.length - 1;
  let exportedIndex = exportedSegments.length - 1;

  while (liveIndex >= 0 && exportedIndex >= 0) {
    if (liveSegments[liveIndex] === exportedSegments[exportedIndex]) {
      score += 4;
      liveIndex -= 1;
      exportedIndex -= 1;
      continue;
    }

    const liveTag = liveSegments[liveIndex].split(":")[0];
    const exportedTag = exportedSegments[exportedIndex].split(":")[0];
    if (liveTag === exportedTag) {
      score += 1;
    }
    break;
  }

  return score;
}

export function useTimelineIndex(timelineEntries: TimelineEntry[]) {
  const timelineLookupRef = useRef<Map<string, TimelineEntry>>(new Map());
  const timelinePathGroupsRef = useRef<Map<string, TimelineEntry[]>>(new Map());
  const timelinePathCoverageRef = useRef<Map<string, Set<number>>>(new Map());
  const timelineNormalizedPathGroupsRef = useRef<Map<string, TimelineEntry[]>>(new Map());
  const timelineNormalizedPathCoverageRef = useRef<Map<string, Set<number>>>(new Map());
  const timelineHrefGroupsRef = useRef<Map<string, TimelineEntry[]>>(new Map());

  useEffect(() => {
    const nextLookup = new Map<string, TimelineEntry>();
    const nextPathGroups = new Map<string, TimelineEntry[]>();
    const nextPathCoverage = new Map<string, Set<number>>();
    const nextNormalizedPathGroups = new Map<string, TimelineEntry[]>();
    const nextNormalizedPathCoverage = new Map<string, Set<number>>();
    const nextHrefGroups = new Map<string, TimelineEntry[]>();

    for (const entry of timelineEntries) {
      const parsed = parseTimelineRef(entry.cfi);
      nextLookup.set(timelineLookupKey(parsed.href, parsed.path, parsed.wordIndex), entry);

      const pathKey = timelineLookupKey(parsed.href, parsed.path, null);
      const pathEntries = nextPathGroups.get(pathKey) ?? [];
      pathEntries.push(entry);
      nextPathGroups.set(pathKey, pathEntries);

      const normalizedPathKey = timelineLookupKey(
        parsed.href,
        normalizePathForLookup(parsed.path),
        null
      );
      const normalizedPathEntries = nextNormalizedPathGroups.get(normalizedPathKey) ?? [];
      normalizedPathEntries.push(entry);
      nextNormalizedPathGroups.set(normalizedPathKey, normalizedPathEntries);

      if (parsed.wordIndex !== null) {
        const pathCoverage = nextPathCoverage.get(pathKey) ?? new Set<number>();
        pathCoverage.add(parsed.wordIndex);
        nextPathCoverage.set(pathKey, pathCoverage);

        const normalizedPathCoverage =
          nextNormalizedPathCoverage.get(normalizedPathKey) ?? new Set<number>();
        normalizedPathCoverage.add(parsed.wordIndex);
        nextNormalizedPathCoverage.set(normalizedPathKey, normalizedPathCoverage);
      }

      if (parsed.href) {
        const hrefEntries = nextHrefGroups.get(parsed.href) ?? [];
        hrefEntries.push(entry);
        nextHrefGroups.set(parsed.href, hrefEntries);
      }
    }

    for (const entries of nextPathGroups.values()) {
      entries.sort((a, b) => {
        const parsedA = parseTimelineRef(a.cfi);
        const parsedB = parseTimelineRef(b.cfi);
        return (parsedA.wordIndex ?? 0) - (parsedB.wordIndex ?? 0);
      });
    }

    for (const entries of nextNormalizedPathGroups.values()) {
      entries.sort((a, b) => {
        const parsedA = parseTimelineRef(a.cfi);
        const parsedB = parseTimelineRef(b.cfi);
        return (parsedA.wordIndex ?? 0) - (parsedB.wordIndex ?? 0);
      });
    }

    for (const entries of nextHrefGroups.values()) {
      entries.sort((a, b) => a.start - b.start);
    }

    timelineLookupRef.current = nextLookup;
    timelinePathGroupsRef.current = nextPathGroups;
    timelinePathCoverageRef.current = nextPathCoverage;
    timelineNormalizedPathGroupsRef.current = nextNormalizedPathGroups;
    timelineNormalizedPathCoverageRef.current = nextNormalizedPathCoverage;
    timelineHrefGroupsRef.current = nextHrefGroups;
  }, [timelineEntries]);

  function findNearestEntryForPath(
    href: string | null,
    path: string,
    wordIndex: number | null
  ): TimelineEntry | null {
    if (!href) {
      return null;
    }

    const entries = timelinePathGroupsRef.current.get(
      timelineLookupKey(href, path, null)
    );

    if (!entries?.length) {
      return null;
    }

    if (wordIndex === null) {
      return entries[0];
    }

    let best = entries[0];
    let bestDistance = Math.abs((parseTimelineRef(best.cfi).wordIndex ?? 0) - wordIndex);

    for (const entry of entries) {
      const candidateIndex = parseTimelineRef(entry.cfi).wordIndex ?? 0;
      const distance = Math.abs(candidateIndex - wordIndex);
      if (distance < bestDistance) {
        best = entry;
        bestDistance = distance;
      }
    }

    return best;
  }

  function findNearestEntryForNormalizedPath(
    href: string | null,
    normalizedPath: string,
    wordIndex: number | null
  ): TimelineEntry | null {
    if (!href) {
      return null;
    }

    const entries = timelineNormalizedPathGroupsRef.current.get(
      timelineLookupKey(href, normalizedPath, null)
    );

    if (!entries?.length) {
      return null;
    }

    if (wordIndex === null) {
      return entries[0];
    }

    let best = entries[0];
    let bestDistance = Math.abs((parseTimelineRef(best.cfi).wordIndex ?? 0) - wordIndex);

    for (const entry of entries) {
      const candidateIndex = parseTimelineRef(entry.cfi).wordIndex ?? 0;
      const distance = Math.abs(candidateIndex - wordIndex);
      if (distance < bestDistance) {
        best = entry;
        bestDistance = distance;
      }
    }

    return best;
  }

  function findNearestEntryForLivePath(
    href: string | null,
    livePath: string,
    wordIndex: number | null
  ): { entry: TimelineEntry; path: string; score: number } | null {
    if (!href) {
      return null;
    }

    let bestMatch: { entry: TimelineEntry; path: string; score: number } | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const entries of timelinePathGroupsRef.current.values()) {
      if (!entries.length) {
        continue;
      }

      const parsed = parseTimelineRef(entries[0].cfi);
      if (parsed.href !== href || !parsed.path) {
        continue;
      }

      const score = scorePathSuffixSimilarity(livePath, parsed.path);
      if (score <= 0) {
        continue;
      }

      const entry = findNearestEntryForPath(href, parsed.path, wordIndex);
      if (!entry) {
        continue;
      }

      const candidateIndex = parseTimelineRef(entry.cfi).wordIndex ?? 0;
      const distance = wordIndex === null ? 0 : Math.abs(candidateIndex - wordIndex);

      if (
        !bestMatch ||
        score > bestMatch.score ||
        (score === bestMatch.score && distance < bestDistance)
      ) {
        bestMatch = {
          entry,
          path: parsed.path,
          score
        };
        bestDistance = distance;
      }
    }

    return bestMatch;
  }

  function findNearestEntryForHref(href: string | null): TimelineEntry | null {
    if (!href) {
      return null;
    }

    const entries = timelineHrefGroupsRef.current.get(href);
    return entries?.[0] ?? null;
  }

  function findClosestTimelinePathContext(
    href: string | null,
    element: Element | null,
    doc: Document
  ): { element: Element; path: string; coverage: Set<number> } | null {
    let currentElement = element;

    while (currentElement && currentElement !== doc.body.parentElement) {
      const candidatePath = buildElementPath(currentElement, doc);
      const candidateCoverage = timelinePathCoverageRef.current.get(
        timelineLookupKey(href, candidatePath, null)
      );

      if (candidateCoverage?.size) {
        return {
          element: currentElement,
          path: candidatePath,
          coverage: candidateCoverage
        };
      }

      const normalizedCandidatePath = normalizePathForLookup(candidatePath);
      const normalizedCoverage = timelineNormalizedPathCoverageRef.current.get(
        timelineLookupKey(href, normalizedCandidatePath, null)
      );
      const normalizedEntry =
        normalizedCandidatePath !== candidatePath
          ? findNearestEntryForNormalizedPath(href, normalizedCandidatePath ?? "", null)
          : null;

      if (normalizedCoverage?.size && normalizedEntry) {
        const exportedPath = parseTimelineRef(normalizedEntry.cfi).path;
        if (exportedPath) {
          return {
            element: currentElement,
            path: exportedPath,
            coverage: normalizedCoverage
          };
        }
      }

      currentElement = currentElement.parentElement;
    }

    return null;
  }

  return {
    timelineLookupRef,
    findClosestTimelinePathContext,
    findNearestEntryForHref,
    findNearestEntryForLivePath,
    findNearestEntryForPath,
    wordIndexWithinElement
  };
}
