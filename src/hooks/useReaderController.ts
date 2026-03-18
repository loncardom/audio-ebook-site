import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import ePub, { Book, RelocatedLocation, Rendition } from "epubjs";
import {
  isEpubFile,
  resolveSampleBooks,
  type SampleBookAssetSet,
  type TimelineOption
} from "../lib/assets";
import { debugLog } from "../lib/debug";
import { fetchGoogleBookMetadata } from "../lib/googleBooks";
import {
  buildElementPath,
  resolveClickTextPosition,
  wordIndexWithinElement
} from "../lib/epubDom";
import { fetchArrayBuffer, fetchTimeline, readFileAsArrayBuffer } from "../lib/readerFiles";
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
import { useTimelineIndex } from "./useTimelineIndex";

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

type PendingUploadSet = {
  epubFile: File;
  audioFile: File;
  timelineFile: File;
};

export function useReaderController() {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioObjectUrlRef = useRef<string | null>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const statusRef = useRef<ReaderStatus>("idle");
  const isTurningPageRef = useRef(false);
  const appActiveRef = useRef(true);
  const activeHighlightElementRef = useRef<HTMLElement | null>(null);
  const followedHrefRef = useRef<string | null>(null);
  const activeWordIndexRef = useRef<number | null>(null);
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
  const [pendingUploadSet, setPendingUploadSet] = useState<PendingUploadSet | null>(null);
  const [pendingSampleBook, setPendingSampleBook] = useState<SampleBookAssetSet | null>(null);
  const [showReaderUi, setShowReaderUi] = useState(true);
  const [viewerMounted, setViewerMounted] = useState(false);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [timelineEntries, setTimelineEntries] = useState<TimelineEntry[]>([]);
  const [timelineOptions, setTimelineOptions] = useState<TimelineOption[]>([]);
  const [selectedTimelineUrl, setSelectedTimelineUrl] = useState<string | null>(null);
  const [sampleBooks, setSampleBooks] = useState<SampleBookAssetSet[]>([]);
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
  const {
    timelineLookupRef,
    findClosestTimelinePathContext,
    findNearestEntryForHref,
    findNearestEntryForLivePath,
    findNearestEntryForPath
  } = useTimelineIndex(timelineEntries);

  const isDarkMode = themePreference === "system" ? systemPrefersDark : themePreference === "dark";

  const revokeAudioObjectUrl = useCallback(() => {
    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }
  }, []);

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
      revokeAudioObjectUrl();
      cleanupReader();
    };
  }, [revokeAudioObjectUrl]);

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
    void resolveSampleBooks().then((books) => {
      if (!appActiveRef.current) {
        return;
      }
      setSampleBooks(books);
    });
  }, []);

  useEffect(() => {
    if (routePath !== "/reader" || !pendingUploadSet || !viewerMounted) {
      return;
    }

    const nextUploadSet = pendingUploadSet;
    setPendingUploadSet(null);
    void loadUploadedBundle(nextUploadSet);
  }, [routePath, pendingUploadSet, viewerMounted]);

  useEffect(() => {
    if (routePath !== "/reader" || !pendingSampleBook || !viewerMounted) {
      return;
    }

    const nextSampleBook = pendingSampleBook;
    setPendingSampleBook(null);
    void loadSampleBundle(nextSampleBook);
  }, [routePath, pendingSampleBook, viewerMounted]);

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
    revokeAudioObjectUrl();
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
    setPendingUploadSet(null);
    setPendingSampleBook(null);
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

  async function parseTimelineFile(file: File): Promise<TimelineEntry[]> {
    const text = await file.text();
    const payload = JSON.parse(text) as unknown;
    if (!Array.isArray(payload)) {
      throw new Error("Timeline JSON must be an array.");
    }

    return payload.filter(
      (entry): entry is TimelineEntry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as Partial<TimelineEntry>).cfi === "string"
    );
  }

  async function loadUploadedBundle(bundle: PendingUploadSet) {
    resetPlayback();
    setLandingNotice("");
    setTimelineOptions([]);
    setSelectedTimelineUrl(null);

    const [bookData, uploadedTimeline] = await Promise.all([
      readFileAsArrayBuffer(bundle.epubFile),
      parseTimelineFile(bundle.timelineFile)
    ]);

    const nextAudioUrl = URL.createObjectURL(bundle.audioFile);
    audioObjectUrlRef.current = nextAudioUrl;
    setAudioSrc(nextAudioUrl);
    setTimelineEntries(uploadedTimeline);

    await loadBookFromBinary(bookData, bundle.epubFile.name);
  }

  async function loadSampleBundle(sample: SampleBookAssetSet) {
    resetPlayback();
    const selectedTimeline = sample.timelineOptions[0]?.timelineUrl ?? sample.timelineUrl;
    const [bookData, sampleTimeline] = await Promise.all([
      fetchArrayBuffer(sample.epubUrl),
      selectedTimeline ? fetchTimeline(selectedTimeline) : Promise.resolve([])
    ]);

    setAudioSrc(sample.audioUrl);
    setTimelineEntries(sampleTimeline);
    setTimelineOptions(sample.timelineOptions);
    setSelectedTimelineUrl(selectedTimeline);
    await loadBookFromBinary(bookData, `${sample.bookTitle}.epub`);
  }

  async function loadSampleBook(sample: SampleBookAssetSet) {
    setLandingNotice("");
    setStatus("loading");
    setShowReaderUi(true);
    setPendingSampleBook(sample);
    navigate("/reader");
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

  function extractUploadSet(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    const epubFile = files.find((file) => isEpubFile(file));
    const audioFile = files.find((file) => file.name.toLowerCase().endsWith(".mp3"));
    const timelineFile = files.find((file) => file.name.toLowerCase().endsWith(".json"));

    if (!epubFile || !audioFile || !timelineFile) {
      setLandingNotice("Please provide one .epub, one .mp3, and one .json file.");
      return null;
    }

    return { epubFile, audioFile, timelineFile };
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files?.length) {
      return;
    }

    const nextUploadSet = extractUploadSet(files);
    event.target.value = "";
    if (!nextUploadSet) {
      return;
    }

    setLandingNotice("");
    setPendingUploadSet(nextUploadSet);
    navigate("/reader");
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);

    const files = event.dataTransfer.files;
    if (!files?.length) {
      return;
    }

    const nextUploadSet = extractUploadSet(files);
    if (!nextUploadSet) {
      return;
    }

    setLandingNotice("");
    setPendingUploadSet(nextUploadSet);
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
    sampleBooks,
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
    loadSampleBook,
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
