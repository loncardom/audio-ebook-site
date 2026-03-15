import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import ePub, { Book, RelocatedLocation, Rendition } from "epubjs";
import {
  isEpubFile,
  resolveAutoBootAssetSet,
  type TimelineOption
} from "../lib/assets";
import { debugLog } from "../lib/debug";
import { fetchGoogleBookMetadata } from "../lib/googleBooks";
import {
  buildElementPath,
  resolveClickTextPosition,
  wordIndexWithinElement
} from "../lib/epubDom";
import { chapterLabel, formatClock, pageNumberLabel } from "../lib/readerFormat";
import {
  extractHrefFromLocator,
  findTimelineIndexAtTime,
  hrefMatches,
  normalizeHref,
  parseTimelineRef,
  timelineLookupKey,
  type TimelineEntry
} from "../lib/timeline";

type ReaderStatus = "idle" | "loading" | "ready" | "error";
type RoutePath = "/" | "/reader";
const SPREAD_BREAKPOINT_PX = 800;
const DEBUG_UNMATCHED_WORDS_KEY = "reader:debug-unmatched-words";
type ThemePreference = "system" | "light" | "dark";
type BookMetadata = {
  title: string | null;
  author: string | null;
  description: string | null;
  coverUrl: string | null;
};

function normalizePathForLookup(path: string | null): string | null {
  if (!path) {
    return null;
  }

  return path.replace(/:nth-of-type\(1\)/g, "");
}

export function useReaderController() {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const statusRef = useRef<ReaderStatus>("idle");
  const isTurningPageRef = useRef(false);
  const autoBootAttemptedRef = useRef(false);
  const appActiveRef = useRef(true);
  const activeHighlightElementRef = useRef<HTMLElement | null>(null);
  const followedHrefRef = useRef<string | null>(null);
  const activeWordIndexRef = useRef<number | null>(null);
  const timelineLookupRef = useRef<Map<string, TimelineEntry>>(new Map());
  const timelinePathGroupsRef = useRef<Map<string, TimelineEntry[]>>(new Map());
  const timelinePathCoverageRef = useRef<Map<string, Set<number>>>(new Map());
  const timelineNormalizedPathGroupsRef = useRef<Map<string, TimelineEntry[]>>(new Map());
  const timelineNormalizedPathCoverageRef = useRef<Map<string, Set<number>>>(new Map());
  const timelineHrefGroupsRef = useRef<Map<string, TimelineEntry[]>>(new Map());
  const spreadLayoutRef = useRef(false);

  const [routePath, setRoutePath] = useState<RoutePath>(
    window.location.pathname === "/reader" ? "/reader" : "/"
  );
  const [status, setStatus] = useState<ReaderStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [landingNotice, setLandingNotice] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isTurningPage, setIsTurningPage] = useState(false);
  const [bookTitle, setBookTitle] = useState("No book loaded");
  const [bookAuthor, setBookAuthor] = useState<string | null>(null);
  const [bookDescription, setBookDescription] = useState<string | null>(null);
  const [bookCoverUrl, setBookCoverUrl] = useState<string | null>(null);
  const [location, setLocation] = useState<RelocatedLocation | null>(null);
  const [totalLocations, setTotalLocations] = useState(0);
  const [currentLocationIndex, setCurrentLocationIndex] = useState<number | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showReaderUi, setShowReaderUi] = useState(true);
  const [viewerMounted, setViewerMounted] = useState(false);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [timelineEntries, setTimelineEntries] = useState<TimelineEntry[]>([]);
  const [timelineOptions, setTimelineOptions] = useState<TimelineOption[]>([]);
  const [selectedTimelineUrl, setSelectedTimelineUrl] = useState<string | null>(null);
  const [isSwitchingTimeline, setIsSwitchingTimeline] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeWordIndex, setActiveWordIndex] = useState<number | null>(null);
  const [isSpreadLayout, setIsSpreadLayout] = useState(spreadLayoutRef.current);
  const [renderVersion, setRenderVersion] = useState(0);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  const [debugUnmatchedWordsEnabled, setDebugUnmatchedWordsEnabled] = useState(() => {
    try {
      return window.localStorage.getItem(DEBUG_UNMATCHED_WORDS_KEY) === "1";
    } catch {
      return false;
    }
  });

  const isDarkMode = themePreference === "system" ? systemPrefersDark : themePreference === "dark";

  const applyBookMetadata = useCallback((metadata: BookMetadata) => {
    setBookTitle(metadata.title?.trim() || "Untitled book");
    setBookAuthor(metadata.author?.trim() || null);
    setBookDescription(metadata.description?.trim() || null);
    setBookCoverUrl(metadata.coverUrl ?? null);
  }, []);

  const updateSpreadLayout = useCallback((width: number) => {
    if (width <= 0) {
      return;
    }

    const nextIsSpreadLayout = width >= SPREAD_BREAKPOINT_PX;
    if (spreadLayoutRef.current === nextIsSpreadLayout) {
      return;
    }

    spreadLayoutRef.current = nextIsSpreadLayout;
    setIsSpreadLayout(nextIsSpreadLayout);
    debugLog("layout:breakpoint-change", { width, spread: nextIsSpreadLayout });
  }, []);

  const handleViewerRef = useCallback((node: HTMLDivElement | null) => {
    viewerRef.current = node;
    setViewerMounted(Boolean(node));
    updateSpreadLayout(node?.clientWidth ?? 0);
    debugLog("viewerRef:update", { mounted: Boolean(node), width: node?.clientWidth ?? 0 });
  }, [updateSpreadLayout]);

  const mountRendition = useCallback(
    async (book: Book, displayTarget?: string) => {
      if (!viewerRef.current) {
        throw new Error("Reader viewport is unavailable.");
      }

      viewerRef.current.innerHTML = "";

      const rendition = book.renderTo(viewerRef.current, {
        width: "100%",
        height: "100%",
        spread: "auto",
        minSpreadWidth: SPREAD_BREAKPOINT_PX,
        flow: "paginated",
        manager: "default"
      });
      debugLog("loadBook:rendition-created", {
        spread: "auto",
        minSpreadWidth: SPREAD_BREAKPOINT_PX
      });
      rendition.themes.fontSize("112%");

      const handleRelocated = (nextLocation: RelocatedLocation) => {
        debugLog("rendition:relocated", {
          href: nextLocation.start.href,
          cfi: nextLocation.start.cfi,
          percentage: nextLocation.percentage
        });
        setLocation(nextLocation);
        const cfi = nextLocation.start.cfi;
        if (!cfi) {
          setCurrentLocationIndex(null);
          return;
        }

        const nextIndex = book.locations.locationFromCfi(cfi);
        setCurrentLocationIndex(Number.isFinite(nextIndex) ? nextIndex : null);
      };

      const handleReaderKeyUp = (event: KeyboardEvent) => {
        if (event.key === "ArrowLeft" || event.keyCode === 37) {
          event.preventDefault();
          void turnPage("prev");
        }

        if (event.key === "ArrowRight" || event.keyCode === 39) {
          event.preventDefault();
          void turnPage("next");
        }
      };

      const handleRendered = () => {
        setRenderVersion((version) => version + 1);
      };

      rendition.on("rendered", handleRendered);
      rendition.on("relocated", handleRelocated);
      rendition.on("keyup", handleReaderKeyUp);
      renditionRef.current = rendition;

      debugLog("loadBook:display-start", {
        target: displayTarget ?? null
      });
      await rendition.display(displayTarget);
      debugLog("loadBook:display-done", { spread: spreadLayoutRef.current ? "both" : "none" });

      return rendition;
    },
    []
  );

  const applyReaderTheme = useCallback((darkMode: boolean) => {
    if (!renditionRef.current) {
      return;
    }

    const bodyColor = darkMode ? "#f3eadf" : "#221b16";
    const bodyBackground = darkMode ? "#1a1612" : "#fdf9f2";
    const linkColor = darkMode ? "#ffb067" : "#a04f13";
    const highlightBackground = darkMode
      ? "rgba(255, 176, 103, 0.28)"
      : "rgba(255, 159, 67, 0.30)";
    const highlightColor = darkMode ? "#fff7ef" : "#1a120c";
    const highlightShadow = darkMode
      ? "0 0 0 0.12em rgba(255, 176, 103, 0.16)"
      : "0 0 0 0.12em rgba(255, 159, 67, 0.18)";
    const unmatchedBackground = darkMode
      ? "rgba(244, 63, 94, 0.28)"
      : "rgba(239, 68, 68, 0.18)";
    const unmatchedColor = darkMode ? "#ffd7dd" : "#7f1321";

    renditionRef.current.themes.default({
      body: {
        "font-size": "1.12em",
        "line-height": "1.6",
        color: bodyColor,
        "background-color": bodyBackground
      },
      a: {
        color: linkColor
      },
      ".sync-word-highlight-dom": {
        "background-color": highlightBackground,
        color: highlightColor,
        "border-radius": "0.22em",
        "box-shadow": highlightShadow
      },
      ".timeline-unmatched-debug": {
        "background-color": unmatchedBackground,
        color: unmatchedColor,
        "border-radius": "0.18em"
      }
    });

    const contentsList = (
      renditionRef.current as Rendition & {
        getContents?: () => Array<{ document?: Document }>;
      }
    ).getContents?.() ?? [];

    for (const contents of contentsList) {
      const doc = contents.document;
      if (!doc) {
        continue;
      }

      doc.documentElement.style.colorScheme = darkMode ? "dark" : "light";
      doc.body.style.backgroundColor = bodyBackground;
      doc.body.style.color = bodyColor;
    }
  }, []);

  async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(reader.result);
          return;
        }
        reject(new Error("The selected file could not be read as binary data."));
      };

      reader.onerror = () => {
        reject(reader.error ?? new Error("The selected file could not be read."));
      };

      reader.readAsArrayBuffer(file);
    });
  }

  async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
    debugLog("fetchArrayBuffer:start", { url });
    const response = await fetch(url);
    debugLog("fetchArrayBuffer:response", { url, ok: response.ok, status: response.status });
    if (!response.ok) {
      throw new Error(`Failed to load ${url}`);
    }

    const data = await response.arrayBuffer();
    debugLog("fetchArrayBuffer:done", { url, bytes: data.byteLength });
    return data;
  }

  async function fetchTimeline(url: string): Promise<TimelineEntry[]> {
    debugLog("fetchTimeline:start", { url });
    const response = await fetch(url);
    debugLog("fetchTimeline:response", { url, ok: response.ok, status: response.status });
    if (!response.ok) {
      throw new Error(`Failed to load ${url}`);
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      debugLog("fetchTimeline:invalid-shape", {
        url,
        payloadType: payload === null ? "null" : typeof payload
      });
      return [];
    }

    const filtered = payload.filter(
      (entry): entry is TimelineEntry => {
        if (typeof entry !== "object" || entry === null) {
          return false;
        }

        const candidate = entry as Partial<TimelineEntry>;
        return typeof candidate.cfi === "string" && candidate.cfi.length > 0;
      }
    );
    debugLog("fetchTimeline:done", { url, total: payload.length, usable: filtered.length });
    return filtered;
  }

  async function switchTimelineSource(nextTimelineUrl: string) {
    if (!nextTimelineUrl || nextTimelineUrl === selectedTimelineUrl) {
      return;
    }

    setIsSwitchingTimeline(true);
    try {
      const nextTimelineEntries = await fetchTimeline(nextTimelineUrl);
      setTimelineEntries(nextTimelineEntries);
      setSelectedTimelineUrl(nextTimelineUrl);

      const nextTime = audioRef.current?.currentTime ?? currentTime;
      const nextIndex = findTimelineIndexAtTime(
        nextTimelineEntries,
        nextTime,
        activeWordIndexRef.current
      );
      activeWordIndexRef.current = nextIndex;
      setActiveWordIndex(nextIndex);
      debugLog("timeline:switch", {
        timelineUrl: nextTimelineUrl,
        total: nextTimelineEntries.length
      });
    } catch (error) {
      debugLog("timeline:switch-failed", error);
      setLandingNotice("Could not load the selected timeline JSON.");
    } finally {
      setIsSwitchingTimeline(false);
    }
  }

  function clearActiveHighlight() {
    const highlighted = activeHighlightElementRef.current;
    if (highlighted?.parentNode) {
      const parent = highlighted.parentNode;
      while (highlighted.firstChild) {
        parent.insertBefore(highlighted.firstChild, highlighted);
      }
      parent.removeChild(highlighted);
      parent.normalize();
    }

    activeHighlightElementRef.current = null;
  }

  function clearUnmatchedDebugMarks(doc?: Document) {
    const currentRendition = renditionRef.current as
      | (Rendition & {
          getContents?: () => Array<{ document?: Document }>;
        })
      | null;

    const docs: Document[] = doc
      ? [doc]
      : currentRendition
        ? (currentRendition.getContents?.() ?? [])
            .map((contents) => contents.document)
            .filter((candidate): candidate is Document => Boolean(candidate))
        : [];

    for (const currentDoc of docs) {
      for (const marker of Array.from(currentDoc.querySelectorAll(".timeline-unmatched-debug"))) {
        const parent = marker.parentNode;
        if (!parent) {
          continue;
        }

        while (marker.firstChild) {
          parent.insertBefore(marker.firstChild, marker);
        }
        parent.removeChild(marker);
        parent.normalize();
      }
    }
  }

  function applyUnmatchedDebugMarks(doc: Document) {
    const href = normalizeHref(
      doc.querySelector("link[rel='canonical']")?.getAttribute("href") ??
        doc.location?.pathname ??
        location?.start.href ??
        null
    );
    if (!href) {
      return;
    }

    const textNodes: Array<{
      textNode: Text;
      parentElement: Element;
      ranges: Array<{ start: number; end: number }>;
    }> = [];

    const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT);
    const wordPattern = /\S+/g;

    while (walker.nextNode()) {
      const textNode = walker.currentNode as Text;
      const parentElement = textNode.parentElement;
      const text = textNode.textContent ?? "";
      if (!parentElement || !text.trim()) {
        continue;
      }

      if (
        parentElement.closest(
          "a[href], .sync-word-highlight-dom, .timeline-unmatched-debug, script, style"
        )
      ) {
        continue;
      }

      const pathContext = findClosestTimelinePathContext(href, parentElement, doc);
      const matchedElement = pathContext?.element ?? null;
      const path = pathContext?.path ?? null;
      const coverage = pathContext?.coverage ?? null;

      if (!matchedElement || !path || !coverage) {
        continue;
      }

      const unmatchedRanges: Array<{ start: number; end: number }> = [];
      wordPattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = wordPattern.exec(text)) !== null) {
        const wordIndex = wordIndexWithinElement(matchedElement, textNode, match.index);
        if (wordIndex === null) {
          continue;
        }

        const exactEntry = timelineLookupRef.current.get(
          timelineLookupKey(href, path, wordIndex)
        );
        if (!exactEntry && !coverage.has(wordIndex)) {
          unmatchedRanges.push({
            start: match.index,
            end: match.index + match[0].length
          });
        }
      }

      if (unmatchedRanges.length) {
        textNodes.push({ textNode, parentElement, ranges: unmatchedRanges });
      }
    }

    for (const entry of textNodes) {
      const originalText = entry.textNode.textContent ?? "";
      const fragment = doc.createDocumentFragment();
      let cursor = 0;

      for (const range of entry.ranges) {
        if (range.start > cursor) {
          fragment.append(doc.createTextNode(originalText.slice(cursor, range.start)));
        }

        const marker = doc.createElement("span");
        marker.className = "timeline-unmatched-debug";
        marker.textContent = originalText.slice(range.start, range.end);
        fragment.append(marker);
        cursor = range.end;
      }

      if (cursor < originalText.length) {
        fragment.append(doc.createTextNode(originalText.slice(cursor)));
      }

      entry.textNode.parentNode?.replaceChild(fragment, entry.textNode);
    }
  }

  function applyDomHighlight(ref: string): boolean {
    const parsed = parseTimelineRef(ref);
    if (!parsed.href || !parsed.path || parsed.wordIndex === null || !renditionRef.current) {
      debugLog("highlight:invalid-ref", { ref, parsed });
      return false;
    }

    const contentsList = (
      renditionRef.current as Rendition & {
        getContents?: () => Array<{ document?: Document }>;
      }
    ).getContents?.() ?? [];

    const matchingContents = contentsList.find((contents) => {
      const currentHref = normalizeHref(
        contents.document?.querySelector("link[rel='canonical']")?.getAttribute("href") ??
          contents.document?.location?.pathname ??
          null
      );
      return hrefMatches(currentHref, parsed.href);
    });

    const doc = matchingContents?.document;
    if (!doc) {
      debugLog("highlight:no-matching-contents", { ref, parsed });
      return false;
    }

    let targetElement: Element | null = null;
    try {
      targetElement = doc.querySelector(parsed.path);
    } catch {
      debugLog("highlight:bad-selector", { ref, path: parsed.path });
      return false;
    }

    if (!targetElement) {
      debugLog("highlight:no-target-element", { ref, path: parsed.path });
      return false;
    }

    const walker = doc.createTreeWalker(targetElement, NodeFilter.SHOW_TEXT);
    const wordPattern = /\S+/g;
    let seenWords = 0;

    while (walker.nextNode()) {
      const textNode = walker.currentNode as Text;
      const text = textNode.textContent ?? "";
      wordPattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = wordPattern.exec(text)) !== null) {
        if (seenWords === parsed.wordIndex) {
          const range = doc.createRange();
          range.setStart(textNode, match.index);
          range.setEnd(textNode, match.index + match[0].length);

          const wrapper = doc.createElement("span");
          wrapper.className = "sync-word-highlight-dom";

          try {
            range.surroundContents(wrapper);
          } catch {
            debugLog("highlight:surround-failed", {
              ref,
              word: match[0],
              path: parsed.path,
              wordIndex: parsed.wordIndex
            });
            return false;
          }

          activeHighlightElementRef.current = wrapper;
          debugLog("highlight:applied", {
            ref,
            word: match[0],
            path: parsed.path,
            wordIndex: parsed.wordIndex
          });
          return true;
        }

        seenWords += 1;
      }
    }

    debugLog("highlight:word-index-miss", {
      ref,
      path: parsed.path,
      requestedWordIndex: parsed.wordIndex,
      wordsSeen: seenWords
    });
    return false;
  }

  function syncActiveWord(time: number): number | null {
    const nextIndex = findTimelineIndexAtTime(
      timelineEntries,
      time,
      activeWordIndexRef.current
    );

    if (nextIndex === activeWordIndexRef.current) {
      return nextIndex;
    }

    activeWordIndexRef.current = nextIndex;
    setActiveWordIndex(nextIndex);
    return nextIndex;
  }

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

    for (const entries of nextHrefGroups.values()) {
      entries.sort((a, b) => a.start - b.start);
    }

    for (const entries of nextNormalizedPathGroups.values()) {
      entries.sort((a, b) => {
        const parsedA = parseTimelineRef(a.cfi);
        const parsedB = parseTimelineRef(b.cfi);
        return (parsedA.wordIndex ?? 0) - (parsedB.wordIndex ?? 0);
      });
    }

    timelineLookupRef.current = nextLookup;
    timelinePathGroupsRef.current = nextPathGroups;
    timelinePathCoverageRef.current = nextPathCoverage;
    timelineNormalizedPathGroupsRef.current = nextNormalizedPathGroups;
    timelineNormalizedPathCoverageRef.current = nextNormalizedPathCoverage;
    timelineHrefGroupsRef.current = nextHrefGroups;
  }, [timelineEntries]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        DEBUG_UNMATCHED_WORDS_KEY,
        debugUnmatchedWordsEnabled ? "1" : "0"
      );
    } catch {
      // Ignore storage failures and keep the in-memory preference.
    }
  }, [debugUnmatchedWordsEnabled]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    isTurningPageRef.current = isTurningPage;
  }, [isTurningPage]);

  useEffect(() => {
    appActiveRef.current = true;
    const handlePopState = () => {
      setRoutePath(window.location.pathname === "/reader" ? "/reader" : "/");
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      appActiveRef.current = false;
      window.removeEventListener("popstate", handlePopState);
      if (audioRef.current) {
        audioRef.current.pause();
      }
      cleanupReader();
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) {
      updateSpreadLayout(0);
      return;
    }

    updateSpreadLayout(viewer.clientWidth);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      updateSpreadLayout(entry.contentRect.width);
      renditionRef.current?.resize(entry.contentRect.width, entry.contentRect.height);
    });

    observer.observe(viewer);
    return () => {
      observer.disconnect();
    };
  }, [viewerMounted, updateSpreadLayout]);

  useEffect(() => {
    applyReaderTheme(isDarkMode);
  }, [applyReaderTheme, isDarkMode, renderVersion]);

  useEffect(() => {
    if (autoBootAttemptedRef.current || !import.meta.env.DEV) {
      return;
    }

    autoBootAttemptedRef.current = true;
    void resolveAutoBootAssetSet()
      .then(async (assets) => {
        if (!assets) {
          debugLog("autoboot:no-assets");
          return;
        }

        debugLog("autoboot:start", assets);
        setLandingNotice("");
        setStatus("loading");
        setBookTitle(assets.bookTitle);
        setShowReaderUi(true);
        navigate("/reader");

        const [bookData, timeline] = await Promise.all([
          fetchArrayBuffer(assets.epubUrl),
          assets.timelineUrl ? fetchTimeline(assets.timelineUrl) : Promise.resolve([])
        ]);

        if (!appActiveRef.current) {
          debugLog("autoboot:ignored-inactive");
          return;
        }

        debugLog("autoboot:assets-ready", {
          bookBytes: bookData.byteLength,
          timelineEntries: timeline.length,
          audioUrl: assets.audioUrl
        });
        setTimelineEntries(timeline);
        setTimelineOptions(assets.timelineOptions);
        setSelectedTimelineUrl(assets.timelineUrl);
        setAudioSrc(assets.audioUrl);
        if (!viewerRef.current) {
          debugLog("autoboot:no-viewer");
          throw new Error("Reader viewport was not mounted.");
        }
        void loadBookFromBinary(bookData, `${assets.bookTitle}.epub`);
      })
      .catch((error) => {
        if (!appActiveRef.current) {
          debugLog("autoboot:error-ignored-inactive", error);
          return;
        }

        debugLog("autoboot:failed", error);
        setStatus("idle");
        setLandingNotice(
          "Automatic sample loading was unavailable. You can still upload an EPUB manually."
        );
        navigate("/");
      });
  }, []);

  useEffect(() => {
    if (routePath !== "/reader" || !pendingFile || !viewerMounted) {
      return;
    }

    const nextFile = pendingFile;
    setPendingFile(null);
    void loadBookFromFile(nextFile);
  }, [routePath, pendingFile, viewerMounted]);

  useEffect(() => {
    if (routePath !== "/reader" || status !== "ready") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        void turnPage("prev");
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        void turnPage("next");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [routePath, status]);

  useEffect(() => {
    if (routePath !== "/reader") {
      return;
    }

    let timeoutId = window.setTimeout(() => setShowReaderUi(false), 2200);

    const showUi = () => {
      window.clearTimeout(timeoutId);
      setShowReaderUi(true);
      timeoutId = window.setTimeout(() => setShowReaderUi(false), 2200);
    };

    window.addEventListener("mousemove", showUi);
    window.addEventListener("pointerdown", showUi);
    window.addEventListener("keydown", showUi);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener("mousemove", showUi);
      window.removeEventListener("pointerdown", showUi);
      window.removeEventListener("keydown", showUi);
    };
  }, [routePath, location, status]);

  useEffect(() => {
    if (status !== "ready" || !renditionRef.current) {
      clearUnmatchedDebugMarks();
      clearActiveHighlight();
      return;
    }

    clearActiveHighlight();

    if (activeWordIndex === null) {
      return;
    }

    const activeEntry = timelineEntries[activeWordIndex];
    if (!activeEntry?.cfi) {
      return;
    }

    const parsedRef = parseTimelineRef(activeEntry.cfi);
    const activeHref = parsedRef.href ?? extractHrefFromLocator(activeEntry.cfi);
    const visibleHref = normalizeHref(location?.start.href);
    if (
      activeHref &&
      !hrefMatches(visibleHref, activeHref) &&
      !hrefMatches(followedHrefRef.current, activeHref) &&
      renditionRef.current
    ) {
      followedHrefRef.current = activeHref;
      debugLog("highlight:navigate-to-href", { activeHref, visibleHref });
      void renditionRef.current.display(activeHref).catch(() => undefined);
    } else if (activeHref && hrefMatches(activeHref, visibleHref)) {
      followedHrefRef.current = activeHref;
      void Promise.resolve().then(() => {
        if (activeWordIndexRef.current !== activeWordIndex) {
          return;
        }

        applyDomHighlight(activeEntry.cfi);
      });
    }
  }, [activeWordIndex, location?.start.href, status, timelineEntries]);

  useEffect(() => {
    const currentRendition = renditionRef.current as
      | (Rendition & {
          getContents?: () => Array<{ document?: Document }>;
        })
      | null;
    const contentsList = currentRendition?.getContents?.() ?? [];

    for (const contents of contentsList) {
      const doc = contents.document;
      if (!doc) {
        continue;
      }

      clearUnmatchedDebugMarks(doc);
      if (status === "ready" && debugUnmatchedWordsEnabled && timelineEntries.length) {
        applyUnmatchedDebugMarks(doc);
      }
    }
  }, [
    debugUnmatchedWordsEnabled,
    location?.start.href,
    renderVersion,
    status,
    timelineEntries
  ]);

  function navigate(path: RoutePath) {
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
    setRoutePath(path);
  }

  function resetPlayback() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setActiveWordIndex(null);
    activeWordIndexRef.current = null;
    clearActiveHighlight();
    followedHrefRef.current = null;
  }

  function closeReader() {
    cleanupReader();
    resetPlayback();
    setPendingFile(null);
    setStatus("idle");
    setErrorMessage("");
    setTimelineEntries([]);
    setTimelineOptions([]);
    setSelectedTimelineUrl(null);
    setLocation(null);
    setTotalLocations(0);
    setCurrentLocationIndex(null);
    navigate("/");
  }

  function cleanupReader() {
    clearActiveHighlight();

    if (renditionRef.current) {
      renditionRef.current.destroy();
      renditionRef.current = null;
    }

    if (bookRef.current) {
      bookRef.current.destroy();
      bookRef.current = null;
    }
  }

  async function loadBookFromBinary(bookData: ArrayBuffer, title: string) {
    if (!viewerRef.current) {
      setStatus("error");
      setErrorMessage("Reader viewport is unavailable.");
      return;
    }

    cleanupReader();
    viewerRef.current.innerHTML = "";

    setStatus("loading");
    setErrorMessage("");
    setBookTitle(title.replace(/\.epub$/i, ""));
    setBookAuthor(null);
    setBookDescription(null);
    setBookCoverUrl(null);
    setLocation(null);
    setTotalLocations(0);
    setCurrentLocationIndex(null);
    setShowReaderUi(true);
    followedHrefRef.current = null;

    try {
      debugLog("loadBook:start", { title, bytes: bookData.byteLength });
      const book = ePub();
      debugLog("loadBook:book-created");
      await book.open(bookData, "binary");
      debugLog("loadBook:book-opened");
      await book.ready;
      debugLog("loadBook:book-ready");

      const epubMetadata = await book.loaded.metadata;
      const epubCoverUrl = await book.coverUrl().catch(() => null);
      const fallbackMetadata: BookMetadata = {
        title: epubMetadata.title?.trim() || title.replace(/\.epub$/i, ""),
        author: epubMetadata.creator?.trim() || null,
        description: epubMetadata.description?.trim() || null,
        coverUrl: epubCoverUrl
      };

      applyBookMetadata(fallbackMetadata);
      debugLog("metadata:epub", {
        title: fallbackMetadata.title,
        author: fallbackMetadata.author,
        hasCover: Boolean(fallbackMetadata.coverUrl)
      });

      void fetchGoogleBookMetadata(fallbackMetadata.title, fallbackMetadata.author)
        .then((googleMetadata) => {
          if (bookRef.current !== book || !googleMetadata) {
            return;
          }

          applyBookMetadata({
            title: googleMetadata.title ?? fallbackMetadata.title,
            author: googleMetadata.authors.join(", ") || fallbackMetadata.author,
            description: googleMetadata.description ?? fallbackMetadata.description,
            coverUrl: googleMetadata.coverUrl ?? fallbackMetadata.coverUrl
          });
          debugLog("metadata:google", {
            title: googleMetadata.title ?? fallbackMetadata.title,
            author: googleMetadata.authors.join(", ") || fallbackMetadata.author,
            hasCover: Boolean(googleMetadata.coverUrl ?? fallbackMetadata.coverUrl)
          });
        })
        .catch((error) => {
          if (bookRef.current !== book) {
            return;
          }

          debugLog("metadata:google-failed", error);
        });

      bookRef.current = book;
      await mountRendition(book);
      applyReaderTheme(isDarkMode);
      setStatus("ready");
      debugLog("loadBook:status-ready");

      void book.locations
        .generate(1600)
        .then(() => {
          if (bookRef.current !== book) {
            return;
          }

          debugLog("loadBook:locations-generated", { total: book.locations.length() });
          setTotalLocations(book.locations.length());

          const currentCfi = renditionRef.current ? location?.start.cfi : null;
          if (!currentCfi) {
            return;
          }

          const nextIndex = book.locations.locationFromCfi(currentCfi);
          setCurrentLocationIndex(Number.isFinite(nextIndex) ? nextIndex : null);
        })
        .catch(() => {
          if (bookRef.current !== book) {
            return;
          }

          debugLog("loadBook:locations-generate-failed");
          setTotalLocations(0);
        });
    } catch (error) {
      debugLog("loadBook:failed", error);
      cleanupReader();
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "The EPUB could not be opened."
      );
    }
  }

  async function loadBookFromFile(file: File) {
    if (!isEpubFile(file)) {
      setStatus("error");
      setErrorMessage("Please upload a valid .epub file.");
      return;
    }

    setAudioSrc(null);
    setTimelineEntries([]);
    setTimelineOptions([]);
    setSelectedTimelineUrl(null);
    resetPlayback();

    const bookData = await readFileAsArrayBuffer(file);
    await loadBookFromBinary(bookData, file.name);
  }

  async function turnPage(direction: "prev" | "next") {
    if (
      !renditionRef.current ||
      statusRef.current !== "ready" ||
      isTurningPageRef.current
    ) {
      return;
    }

    isTurningPageRef.current = true;
    setIsTurningPage(true);
    setShowReaderUi(true);
    try {
      if (direction === "prev") {
        await renditionRef.current.prev();
      } else {
        await renditionRef.current.next();
      }
    } finally {
      isTurningPageRef.current = false;
      setIsTurningPage(false);
    }
  }

  async function togglePlayback() {
    if (!audioRef.current || !audioSrc) {
      debugLog("playback:toggle-ignored", { hasAudio: Boolean(audioRef.current), audioSrc });
      return;
    }

    setShowReaderUi(true);

    if (audioRef.current.paused) {
      debugLog("playback:play-request");
      await audioRef.current.play();
    } else {
      debugLog("playback:pause-request");
      audioRef.current.pause();
    }
  }

  function handleScrub(nextValue: number) {
    if (!audioRef.current || !Number.isFinite(nextValue)) {
      return;
    }

    audioRef.current.currentTime = nextValue;
    setCurrentTime(nextValue);
    const nextIndex = syncActiveWord(nextValue);
    if (nextIndex !== null) {
      navigateToTimelineEntry(timelineEntries[nextIndex]);
    }
  }

  function rangeForTimelineRef(ref: string): Range | null {
    const parsed = parseTimelineRef(ref);
    if (!parsed.href || !parsed.path || !renditionRef.current) {
      return null;
    }

    const contentsList = (
      renditionRef.current as Rendition & {
        getContents?: () => Array<{
          document?: Document;
          cfiFromRange?: (range: Range) => string;
        }>;
      }
    ).getContents?.() ?? [];

    const matchingContents = contentsList.find((contents) => {
      const currentHref = normalizeHref(
        contents.document?.querySelector("link[rel='canonical']")?.getAttribute("href") ??
          contents.document?.location?.pathname ??
          null
      );
      return hrefMatches(currentHref, parsed.href);
    });

    const doc = matchingContents?.document;
    if (!doc) {
      return null;
    }

    let targetElement: Element | null = null;
    try {
      targetElement = doc.querySelector(parsed.path);
    } catch {
      return null;
    }

    if (!targetElement) {
      return null;
    }

    if (parsed.wordIndex === null) {
      const range = doc.createRange();
      range.selectNodeContents(targetElement);
      return range;
    }

    const walker = doc.createTreeWalker(targetElement, NodeFilter.SHOW_TEXT);
    const wordPattern = /\S+/g;
    let seenWords = 0;

    while (walker.nextNode()) {
      const textNode = walker.currentNode as Text;
      const text = textNode.textContent ?? "";
      wordPattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = wordPattern.exec(text)) !== null) {
        if (seenWords === parsed.wordIndex) {
          const range = doc.createRange();
          range.setStart(textNode, match.index);
          range.setEnd(textNode, match.index + match[0].length);
          return range;
        }

        seenWords += 1;
      }
    }

    const fallbackRange = doc.createRange();
    fallbackRange.selectNodeContents(targetElement);
    return fallbackRange;
  }

  function navigateToTimelineEntry(entry: TimelineEntry | undefined) {
    if (!entry?.cfi || !renditionRef.current) {
      return;
    }

    const parsed = parseTimelineRef(entry.cfi);
    const activeHref = parsed.href ?? extractHrefFromLocator(entry.cfi);
    if (!activeHref) {
      return;
    }

    const contentsList = (
      renditionRef.current as Rendition & {
        getContents?: () => Array<{
          document?: Document;
          cfiFromRange?: (range: Range) => string;
        }>;
      }
    ).getContents?.() ?? [];

    const matchingContents = contentsList.find((contents) => {
      const currentHref = normalizeHref(
        contents.document?.querySelector("link[rel='canonical']")?.getAttribute("href") ??
          contents.document?.location?.pathname ??
          null
      );
      return hrefMatches(currentHref, activeHref);
    });

    const targetRange = rangeForTimelineRef(entry.cfi);
    const targetCfi =
      targetRange && matchingContents?.cfiFromRange
        ? matchingContents.cfiFromRange(targetRange)
        : null;

    followedHrefRef.current = activeHref;
    debugLog("scrub:navigate", {
      activeHref,
      hasRange: Boolean(targetRange),
      hasCfi: Boolean(targetCfi)
    });

    if (targetCfi) {
      void renditionRef.current.display(targetCfi).catch(() => {
        void renditionRef.current?.display(activeHref).catch(() => undefined);
      });
      return;
    }

    void renditionRef.current.display(activeHref).catch(() => undefined);
  }

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

    for (const [key, entries] of timelinePathGroupsRef.current.entries()) {
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

  useEffect(() => {
    if (status !== "ready" || !timelineEntries.length || !renditionRef.current) {
      return;
    }

    const contentsList = (
      renditionRef.current as Rendition & {
        getContents?: () => Array<{ document?: Document }>;
      }
    ).getContents?.() ?? [];

    const cleanups = contentsList
      .map((contents) => {
        const doc = contents.document;
        if (!doc) {
          return null;
        }

        debugLog("word-click:attach", {
          canonical:
            doc.querySelector("link[rel='canonical']")?.getAttribute("href") ?? null,
          pathname: doc.location?.pathname ?? null
        });

        const handleClick = (event: MouseEvent | PointerEvent) => {
          const rawTarget = event.target;
          const target =
            rawTarget instanceof Element
              ? rawTarget
              : rawTarget instanceof Text
                ? rawTarget.parentElement
                : doc.elementFromPoint(event.clientX, event.clientY);

          if (!target) {
            debugLog("word-click:ignored-non-element", {
              nodeType: rawTarget instanceof Node ? rawTarget.nodeType : null
            });
            return;
          }

          if (target.closest("a[href]")) {
            debugLog("word-click:ignored-link");
            return;
          }

          const position = resolveClickTextPosition(event as MouseEvent, doc);
          if (!position) {
            debugLog("word-click:no-position", {
              x: event.clientX,
              y: event.clientY,
              tag: target.tagName
            });
            return;
          }

          const href = normalizeHref(
            doc.querySelector("link[rel='canonical']")?.getAttribute("href") ??
              location?.start.href ??
              null
          );

          debugLog("word-click:position", {
            href,
            offset: position.offset,
            textSample: position.node.textContent?.slice(0, 80) ?? ""
          });

          const pathContext = findClosestTimelinePathContext(href, position.node.parentElement, doc);
          if (pathContext) {
            const wordIndex = wordIndexWithinElement(
              pathContext.element,
              position.node,
              position.offset
            );
            const exactEntry = timelineLookupRef.current.get(
              timelineLookupKey(href, pathContext.path, wordIndex)
            );
            const nearestPathEntry =
              exactEntry ?? findNearestEntryForPath(href, pathContext.path, wordIndex);

            if (nearestPathEntry) {
              debugLog("word-click:seek", {
                href,
                path: pathContext.path,
                wordIndex,
                start: nearestPathEntry.start,
                word: nearestPathEntry.word,
                exact: Boolean(exactEntry)
              });
              event.preventDefault();
              setShowReaderUi(true);
              handleScrub(nearestPathEntry.start);
              return;
            }

            debugLog("word-click:path-context-miss", {
              href,
              path: pathContext.path,
              wordIndex
            });
          }

          const livePath = position.node.parentElement
            ? buildElementPath(position.node.parentElement, doc)
            : null;
          const liveWordIndex = position.node.parentElement
            ? wordIndexWithinElement(position.node.parentElement, position.node, position.offset)
            : null;
          const fuzzyPathMatch = livePath
            ? findNearestEntryForLivePath(href, livePath, liveWordIndex)
            : null;
          if (fuzzyPathMatch) {
            debugLog("word-click:seek-fuzzy-path", {
              href,
              livePath,
              matchedPath: fuzzyPathMatch.path,
              liveWordIndex,
              start: fuzzyPathMatch.entry.start,
              word: fuzzyPathMatch.entry.word,
              score: fuzzyPathMatch.score
            });
            event.preventDefault();
            setShowReaderUi(true);
            handleScrub(fuzzyPathMatch.entry.start);
            return;
          }

          const hrefFallback = findNearestEntryForHref(href);
          if (hrefFallback) {
            debugLog("word-click:seek-href-fallback", {
              href,
              start: hrefFallback.start,
              word: hrefFallback.word
            });
            event.preventDefault();
            setShowReaderUi(true);
            handleScrub(hrefFallback.start);
            return;
          }

          debugLog("word-click:no-match-found", { href });
        };

        doc.addEventListener("click", handleClick);
        doc.addEventListener("pointerup", handleClick);
        return () => {
          doc.removeEventListener("click", handleClick);
          doc.removeEventListener("pointerup", handleClick);
        };
      })
      .filter((cleanup): cleanup is () => void => Boolean(cleanup));

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, [isSpreadLayout, location?.start.href, renderVersion, status, timelineEntries]);

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setLandingNotice("");
    setPendingFile(file);
    navigate("/reader");
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);

    const file = event.dataTransfer.files?.[0];
    if (!file) {
      return;
    }

    setLandingNotice("");
    setPendingFile(file);
    navigate("/reader");
  }

  function openFilePicker() {
    inputRef.current?.click();
  }

  function toggleDarkMode() {
    setThemePreference((current) => {
      if (current === "system") {
        return systemPrefersDark ? "light" : "dark";
      }

      if (current === "dark") {
        return "light";
      }

      return "dark";
    });
  }

  function toggleDebugUnmatchedWords() {
    setDebugUnmatchedWordsEnabled((current) => !current);
  }

  const ready = status === "ready";
  const pageLabel = pageNumberLabel(location, totalLocations, currentLocationIndex);
  const completion =
    totalLocations > 0 && currentLocationIndex !== null
      ? Math.round((currentLocationIndex / totalLocations) * 100)
      : typeof location?.percentage === "number"
        ? Math.max(0, Math.min(100, Math.round(location.percentage * 100)))
        : 0;

  const chapter = chapterLabel(location);
  const playerTimeLabel = `${formatClock(currentTime)} / ${formatClock(duration)}`;

  return {
    routePath,
    status,
    errorMessage,
    landingNotice,
    isDragging,
    isTurningPage,
    bookTitle,
    bookAuthor,
    bookDescription,
    bookCoverUrl,
    chapter,
    showReaderUi,
    isSpreadLayout,
    ready,
    pageLabel,
    completion,
    audioSrc,
    timelineOptions,
    selectedTimelineUrl,
    isSwitchingTimeline,
    isPlaying,
    currentTime,
    duration,
    playerTimeLabel,
    isDarkMode,
    debugUnmatchedWordsEnabled,
    inputRef,
    audioRef,
    handleViewerRef,
    closeReader,
    turnPage,
    togglePlayback,
    handleScrub,
    switchTimelineSource,
    handleInputChange,
    handleDrop,
    openFilePicker,
    toggleDarkMode,
    toggleDebugUnmatchedWords,
    setIsDragging,
    setShowReaderUi,
    syncActiveWord,
    setIsPlaying,
    setCurrentTime,
    setDuration,
    setActiveWordIndex,
    clearActiveHighlight
  };
}

export type ReaderController = ReturnType<typeof useReaderController>;
