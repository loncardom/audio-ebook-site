import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import ePub, { Book, RelocatedLocation, Rendition } from "epubjs";
import { buildParentAssetUrl, isEpubFile } from "../lib/assets";
import { debugLog } from "../lib/debug";
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
  const [location, setLocation] = useState<RelocatedLocation | null>(null);
  const [totalLocations, setTotalLocations] = useState(0);
  const [currentLocationIndex, setCurrentLocationIndex] = useState<number | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showReaderUi, setShowReaderUi] = useState(true);
  const [viewerMounted, setViewerMounted] = useState(false);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [timelineEntries, setTimelineEntries] = useState<TimelineEntry[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeWordIndex, setActiveWordIndex] = useState<number | null>(null);
  const [isSpreadLayout, setIsSpreadLayout] = useState(spreadLayoutRef.current);
  const [renderVersion, setRenderVersion] = useState(0);

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
      rendition.themes.default({
        body: {
          "font-size": "1.12em",
          "line-height": "1.6",
          color: "#221b16"
        },
        ".sync-word-highlight-dom": {
          "background-color": "rgba(255, 159, 67, 0.30)",
          color: "#1a120c",
          "border-radius": "0.22em",
          "box-shadow": "0 0 0 0.12em rgba(255, 159, 67, 0.18)"
        }
      });

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

    const payload = (await response.json()) as TimelineEntry[];
    const filtered = payload.filter((entry) => typeof entry.cfi === "string" && entry.cfi.length > 0);
    debugLog("fetchTimeline:done", { url, total: payload.length, usable: filtered.length });
    return filtered;
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

  function syncActiveWord(time: number) {
    const nextIndex = findTimelineIndexAtTime(
      timelineEntries,
      time,
      activeWordIndexRef.current
    );

    if (nextIndex === activeWordIndexRef.current) {
      return;
    }

    activeWordIndexRef.current = nextIndex;
    setActiveWordIndex(nextIndex);
  }

  useEffect(() => {
    const nextLookup = new Map<string, TimelineEntry>();
    const nextPathGroups = new Map<string, TimelineEntry[]>();
    const nextHrefGroups = new Map<string, TimelineEntry[]>();

    for (const entry of timelineEntries) {
      const parsed = parseTimelineRef(entry.cfi);
      nextLookup.set(timelineLookupKey(parsed.href, parsed.path, parsed.wordIndex), entry);

      const pathKey = timelineLookupKey(parsed.href, parsed.path, null);
      const pathEntries = nextPathGroups.get(pathKey) ?? [];
      pathEntries.push(entry);
      nextPathGroups.set(pathKey, pathEntries);

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

    timelineLookupRef.current = nextLookup;
    timelinePathGroupsRef.current = nextPathGroups;
    timelineHrefGroupsRef.current = nextHrefGroups;
  }, [timelineEntries]);

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
    if (autoBootAttemptedRef.current || !import.meta.env.DEV) {
      return;
    }

    const epubUrl = buildParentAssetUrl("book.epub");
    const audioUrl = buildParentAssetUrl("asr_0_300s.mp3");
    const timelineUrl = buildParentAssetUrl("book_timeline.json");

    if (!epubUrl || !audioUrl || !timelineUrl) {
      return;
    }

    autoBootAttemptedRef.current = true;
    debugLog("autoboot:start", { epubUrl, audioUrl, timelineUrl });
    setLandingNotice("");
    setStatus("loading");
    setBookTitle("book");
    setShowReaderUi(true);
    navigate("/reader");

    void Promise.all([fetchArrayBuffer(epubUrl), fetchTimeline(timelineUrl)])
      .then(([bookData, timeline]) => {
        if (!appActiveRef.current) {
          debugLog("autoboot:ignored-inactive");
          return;
        }

        debugLog("autoboot:assets-ready", {
          bookBytes: bookData.byteLength,
          timelineEntries: timeline.length,
          audioUrl
        });
        setTimelineEntries(timeline);
        setAudioSrc(audioUrl);
        if (!viewerRef.current) {
          debugLog("autoboot:no-viewer");
          throw new Error("Reader viewport was not mounted.");
        }
        void loadBookFromBinary(bookData, "book.epub");
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
    setLocation(null);
    setTotalLocations(0);
    setCurrentLocationIndex(null);
    setBookTitle("No book loaded");
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

      bookRef.current = book;
      await mountRendition(book);
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
    syncActiveWord(nextValue);
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

  function findNearestEntryForHref(href: string | null): TimelineEntry | null {
    if (!href) {
      return null;
    }

    const entries = timelineHrefGroupsRef.current.get(href);
    return entries?.[0] ?? null;
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

          let currentElement: Element | null = position.node.parentElement;
          while (currentElement && currentElement !== doc.body.parentElement) {
            const path = buildElementPath(currentElement, doc);
            const wordIndex = wordIndexWithinElement(currentElement, position.node, position.offset);
            const exactEntry = timelineLookupRef.current.get(
              timelineLookupKey(href, path, wordIndex)
            );
            const nearestPathEntry = exactEntry ?? findNearestEntryForPath(href, path, wordIndex);

            if (nearestPathEntry) {
              debugLog("word-click:seek", {
                href,
                path,
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

            debugLog("word-click:miss", {
              href,
              path,
              wordIndex,
              tag: currentElement.tagName
            });

            currentElement = currentElement.parentElement;
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
    chapter,
    showReaderUi,
    isSpreadLayout,
    ready,
    pageLabel,
    completion,
    audioSrc,
    isPlaying,
    currentTime,
    duration,
    playerTimeLabel,
    inputRef,
    audioRef,
    handleViewerRef,
    closeReader,
    turnPage,
    togglePlayback,
    handleScrub,
    handleInputChange,
    handleDrop,
    openFilePicker,
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
