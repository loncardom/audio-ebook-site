import { ChangeEvent, DragEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import ePub, { Book, RelocatedLocation, Rendition } from "epubjs";

type ReaderStatus = "idle" | "loading" | "ready" | "error";
type RoutePath = "/" | "/reader";

type TimelineEntry = {
  start: number;
  end: number;
  word: string;
  spoken?: string;
  spine?: number;
  cfi: string;
};

type ParsedTimelineRef = {
  href: string | null;
  path: string | null;
  wordIndex: number | null;
};

function debugLog(step: string, details?: unknown) {
  if (details === undefined) {
    console.log(`[reader-sync] ${step}`);
    return;
  }

  console.log(`[reader-sync] ${step}`, details);
}

function buildParentAssetUrl(fileName: string): string | null {
  if (!import.meta.env.DEV) {
    return null;
  }

  const root = __PARENT_ASSET_ROOT__.replace(/\\/g, "/").replace(/\/$/, "");
  const fsRoot = root.startsWith("/") ? root : `/${root}`;
  return `/@fs${fsRoot}/${fileName}`;
}

function isEpubFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".epub");
}

function normalizeHref(href?: string | null): string | null {
  if (!href) {
    return null;
  }

  return href.split("#")[0];
}

function hrefMatches(candidate: string | null, target: string | null): boolean {
  if (!candidate || !target) {
    return false;
  }

  return candidate === target || candidate.endsWith(target) || target.endsWith(candidate);
}

function extractHrefFromCfi(cfi: string): string | null {
  const match = cfi.match(/href=([^;]+)/);
  return normalizeHref(match?.[1] ?? null);
}

function parseTimelineRef(ref: string): ParsedTimelineRef {
  const hrefMatch = ref.match(/href=([^;]+)/);
  const pathMatch = ref.match(/path=([^;]+)/);
  const wordIndexMatch = ref.match(/w=(\d+)/);

  return {
    href: normalizeHref(hrefMatch?.[1] ?? null),
    path: pathMatch?.[1]?.trim() ?? null,
    wordIndex: wordIndexMatch ? Number(wordIndexMatch[1]) : null
  };
}

function formatProgress(
  location: RelocatedLocation | null,
  totalLocations: number,
  currentLocationIndex: number | null
): string {
  if (!location) {
    return "Waiting for first page";
  }

  const cfi = location.start.cfi;
  if (cfi && totalLocations > 0) {
    const page = locationToPageNumber(totalLocations, currentLocationIndex);
    return `Page ${page} / ${totalLocations}`;
  }

  const page = location.start.displayed?.page;
  const total = location.start.displayed?.total;
  if (page && total) {
    return `Page ${page} / ${total}`;
  }

  if (typeof location.percentage === "number") {
    return `${Math.round(location.percentage * 100)}%`;
  }

  if (location.start.href) {
    return location.start.href;
  }

  return "Page loaded";
}

function locationToPageNumber(
  totalLocations: number,
  currentLocationIndex: number | null
): number {
  if (totalLocations < 1 || currentLocationIndex === null) {
    return 1;
  }

  return Math.min(totalLocations, Math.max(1, currentLocationIndex + 1));
}

function pageNumberLabel(
  location: RelocatedLocation | null,
  totalLocations: number,
  currentLocationIndex: number | null
): string {
  const cfi = location?.start.cfi;
  if (cfi && totalLocations > 0) {
    return `${locationToPageNumber(totalLocations, currentLocationIndex)} of ${totalLocations}`;
  }

  const page = location?.start.displayed?.page;
  const total = location?.start.displayed?.total;

  if (page && total) {
    return `${page} of ${total}`;
  }

  return formatProgress(location, totalLocations, currentLocationIndex);
}

function chapterLabel(location: RelocatedLocation | null): string {
  const label = location?.start?.displayed?.page;
  const href = location?.start?.href;

  if (href) {
    const chunk = href.split("/").pop() ?? href;
    return chunk.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
  }

  if (label) {
    return `Page ${label}`;
  }

  return "Waiting for chapter";
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const rounded = Math.floor(seconds);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function findTimelineIndexAtTime(
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

function IconButton(props: {
  label: string;
  title?: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  const { label, title, onClick, disabled, active, children } = props;

  return (
    <button
      type="button"
      className={`icon-button ${active ? "active" : ""}`}
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.2 3.7 11.1a1 1 0 0 0 .7 1.7H6v7a1.2 1.2 0 0 0 1.2 1.2h3.8v-6h2v6h3.8A1.2 1.2 0 0 0 18 19.8v-7h1.6a1 1 0 0 0 .7-1.7L12 3.2Z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4.5h10A1.5 1.5 0 0 1 18.5 6v14l-6.5-3.8L5.5 20V6A1.5 1.5 0 0 1 7 4.5Z" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19 14.4A7.5 7.5 0 0 1 9.6 5a8.7 8.7 0 1 0 9.4 9.4Z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 3 1.2 2.2 2.5.4.5 2.5 2.1 1.2-1 2.3 1 2.4-2.1 1.2-.5 2.5-2.5.4L12 21l-2.2-1.2-2.5-.4-.5-2.5-2.1-1.2 1-2.4-1-2.3L6.8 8l.5-2.5 2.5-.4L12 3Z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

function StatsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4v15a1 1 0 0 0 1 1h15" />
      <path d="M9 16v-3M13 16V8M17 16V5" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 4H4v4M16 4h4v4M8 20H4v-4M20 20h-4v-4" />
      <path d="m9 9-5-5M15 9l5-5M9 15l-5 5M15 15l5 5" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 16V5" />
      <path d="m7.5 9.5 4.5-4.5 4.5 4.5" />
      <path d="M5 18.5h14" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5.5 4.5h11A2.5 2.5 0 0 1 19 7v12a.5.5 0 0 1-.8.4c-1.6-1.2-3.5-1.9-5.7-1.9H6.8A1.8 1.8 0 0 1 5 15.7V5a.5.5 0 0 1 .5-.5Z" />
      <path d="M8 7.8h7M8 10.8h7" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 6.5v11l9-5.5-9-5.5Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.5 6.5v11M15.5 6.5v11" />
    </svg>
  );
}

export default function App() {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const statusRef = useRef<ReaderStatus>("idle");
  const isTurningPageRef = useRef(false);
  const autoBootAttemptedRef = useRef(false);
  const appActiveRef = useRef(true);
  const activeHighlightCfiRef = useRef<string | null>(null);
  const activeHighlightElementRef = useRef<HTMLElement | null>(null);
  const followedHrefRef = useRef<string | null>(null);
  const activeWordIndexRef = useRef<number | null>(null);

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

  const handleViewerRef = useCallback((node: HTMLDivElement | null) => {
    viewerRef.current = node;
    setViewerMounted(Boolean(node));
    debugLog("viewerRef:update", { mounted: Boolean(node) });
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
    activeHighlightCfiRef.current = null;
  }

  function applyDomHighlight(ref: string): boolean {
    const parsed = parseTimelineRef(ref);
    if (!parsed.href || !parsed.path || parsed.wordIndex === null || !renditionRef.current) {
      debugLog("highlight:invalid-ref", { ref, parsed });
      return false;
    }

    const contentsList = (
      renditionRef.current as Rendition & {
        getContents?: () => Array<{
          document?: Document;
        }>;
      }
    ).getContents?.() ?? [];

    debugLog("highlight:contents", {
      ref,
      parsed,
      contents: contentsList.map((contents) => ({
        canonical:
          contents.document?.querySelector("link[rel='canonical']")?.getAttribute("href") ??
          null,
        pathname: contents.document?.location?.pathname ?? null
      }))
    });

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
          activeHighlightCfiRef.current = ref;
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

    void Promise.all([
      fetchArrayBuffer(epubUrl),
      fetchTimeline(timelineUrl)
    ])
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
    const activeHref = parsedRef.href ?? extractHrefFromCfi(activeEntry.cfi);
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

      const rendition = book.renderTo(viewerRef.current, {
        width: "100%",
        height: "100%",
        spread: "none",
        flow: "paginated",
        manager: "default"
      });
      debugLog("loadBook:rendition-created");

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

      rendition.on("relocated", handleRelocated);
      rendition.on("keyup", handleReaderKeyUp);

      bookRef.current = book;
      renditionRef.current = rendition;

      debugLog("loadBook:display-start");
      await rendition.display();
      debugLog("loadBook:display-done");
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

  if (routePath === "/reader") {
    return (
      <main
        className={`reader-screen ${showReaderUi ? "reader-ui-visible" : ""}`}
        onPointerMove={() => setShowReaderUi(true)}
        onClick={() => setShowReaderUi(true)}
      >
        <audio
          ref={audioRef}
          src={audioSrc ?? undefined}
          preload={audioSrc ? "metadata" : "none"}
          onLoadedMetadata={(event) => {
            debugLog("audio:loaded-metadata", {
              duration: event.currentTarget.duration,
              src: event.currentTarget.currentSrc
            });
            setDuration(event.currentTarget.duration || 0);
            setCurrentTime(event.currentTarget.currentTime || 0);
            syncActiveWord(event.currentTarget.currentTime || 0);
          }}
          onTimeUpdate={(event) => {
            const nextTime = event.currentTarget.currentTime;
            setCurrentTime(nextTime);
            syncActiveWord(nextTime);
          }}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onPlayCapture={() => debugLog("audio:play")}
          onPauseCapture={() => debugLog("audio:pause")}
          onSeeking={(event) => {
            debugLog("audio:seeking", { time: event.currentTarget.currentTime });
            const nextTime = event.currentTarget.currentTime;
            setCurrentTime(nextTime);
            syncActiveWord(nextTime);
          }}
          onSeeked={(event) => {
            debugLog("audio:seeked", { time: event.currentTarget.currentTime });
            const nextTime = event.currentTarget.currentTime;
            setCurrentTime(nextTime);
            syncActiveWord(nextTime);
          }}
          onEnded={() => {
            debugLog("audio:ended");
            setIsPlaying(false);
            setCurrentTime(duration);
            setActiveWordIndex(null);
            activeWordIndexRef.current = null;
            clearActiveHighlight();
          }}
          onError={(event) => {
            const element = event.currentTarget;
            debugLog("audio:error", {
              code: element.error?.code,
              message: element.error?.message,
              src: element.currentSrc
            });
          }}
        />

        <div className="reader-backdrop" />

        <div className="reader-frame">
          <div className={`reader-titlebar ${showReaderUi ? "visible" : ""}`}>
            <div className="reader-toolbar reader-toolbar-left">
              <IconButton label="Go home" onClick={closeReader}>
                <HomeIcon />
              </IconButton>
              <IconButton label="Search in book" disabled={!ready}>
                <SearchIcon />
              </IconButton>
              <IconButton label="Bookmark page" disabled={!ready}>
                <BookmarkIcon />
              </IconButton>
              <IconButton label="Open menu" disabled={!ready}>
                <MenuIcon />
              </IconButton>
            </div>

            <div className="reader-metainfo">
              <span className="reader-book-title">{bookTitle}</span>
              <span className="reader-title-separator">-</span>
              <span className="reader-chapter-title">{chapterLabel(location)}</span>
            </div>

            <div className="reader-toolbar reader-toolbar-right">
              <IconButton label="Toggle dark mode">
                <MoonIcon />
              </IconButton>
              <IconButton label="Open settings">
                <SettingsIcon />
              </IconButton>
              <IconButton label="Show progress">
                <StatsIcon />
              </IconButton>
              <IconButton label="Fullscreen">
                <ExpandIcon />
              </IconButton>
            </div>
          </div>

          <div className="reader-stage">
            <div className="reader-divider" />

            {errorMessage ? <p className="reader-error">{errorMessage}</p> : null}

            {status !== "ready" ? (
              <div className="reader-placeholder">
                <div className="reader-placeholder-card">
                  <span className="status-dot" />
                  <p>{status === "error" ? "Could not open EPUB" : "Opening EPUB"}</p>
                  <span>
                    {status === "error"
                      ? "Load another file from the library screen."
                      : "Loading the default book and preparing sync data."}
                  </span>
                </div>
              </div>
            ) : null}

            <div
              ref={handleViewerRef}
              className={`fullscreen-viewport ${ready ? "visible" : ""}`}
            />

            <button
              type="button"
              className="nav-button nav-button-prev"
              aria-label="Previous page"
              disabled={!ready || isTurningPage}
              onClick={() => void turnPage("prev")}
            >
              <span className="nav-arrow">‹</span>
            </button>

            <button
              type="button"
              className="nav-button nav-button-next"
              aria-label="Next page"
              disabled={!ready || isTurningPage}
              onClick={() => void turnPage("next")}
            >
              <span className="nav-arrow">›</span>
            </button>
          </div>

          <div className={`reader-progress ${showReaderUi ? "visible" : ""}`}>
            <div className="reader-bottom-bar">
              <div className="reader-progress-chip">
                <span>{pageLabel}</span>
              </div>

              {audioSrc ? (
                <div className="player-chip">
                  <button
                    type="button"
                    className="player-button"
                    aria-label={isPlaying ? "Pause audio" : "Play audio"}
                    onClick={() => void togglePlayback()}
                    disabled={!ready}
                  >
                    {isPlaying ? <PauseIcon /> : <PlayIcon />}
                  </button>
                  <span className="player-label">
                    {isPlaying ? "Playing audio sync" : "Play audio sync"}
                  </span>
                  <span className="player-time">
                    {formatClock(currentTime)} / {formatClock(duration)}
                  </span>
                  <input
                    className="player-scrubber"
                    type="range"
                    min={0}
                    max={duration || 0}
                    step={0.1}
                    value={Math.min(currentTime, duration || 0)}
                    onChange={(event) => handleScrub(Number(event.currentTarget.value))}
                    onInput={(event) => handleScrub(Number(event.currentTarget.value))}
                    disabled={!ready || !duration}
                    aria-label="Scrub audio position"
                  />
                </div>
              ) : null}
            </div>

            <div className="reader-progress-meter" aria-hidden="true">
              <span style={{ width: `${completion}%` }} />
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="app-noise" />

      <section className="landing-shell">
        <header className="landing-header">
          <div className="brand-lockup">
            <div className="brand-mark">
              <BookIcon />
            </div>
            <div>
              <p className="brand-name">BiblioPod Style Reader</p>
              <span className="brand-subtitle">Local-first EPUB reader shell</span>
            </div>
          </div>

          <div className="landing-pills">
            <span className="landing-pill">Privacy-first</span>
            <span className="landing-pill">EPUB only</span>
          </div>
        </header>

        <section className="landing-hero">
          <div className="landing-copy">
            <span className="section-tag">Reading Platform</span>
            <h1>Make this reader feel much closer to the reference app.</h1>
            <p className="landing-lede">
              Upload a local EPUB, open it in a full-screen reading view, and keep
              the interaction model centered on clean page turns and ambient controls.
            </p>

            <div className="landing-stats">
              <div className="stat-card">
                <strong>Paginated</strong>
                <span>epub.js flow with keyboard navigation</span>
              </div>
              <div className="stat-card">
                <strong>Auto sample load</strong>
                <span>dev mode can boot the parent `book.epub` automatically</span>
              </div>
              <div className="stat-card">
                <strong>Audio sync</strong>
                <span>play the first chunk and highlight spoken words</span>
              </div>
            </div>
          </div>

          <label
            className={`upload-surface ${isDragging ? "dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept=".epub,application/epub+zip"
              onChange={handleInputChange}
            />

            <div className="upload-icon-wrap">
              <UploadIcon />
            </div>
            <span className="upload-badge">Upload ePub Book</span>
            <strong>Drag and drop an EPUB here</strong>
            <p>
              The file stays on this machine. Open it directly into the redesigned
              reader interface.
            </p>

            {landingNotice ? <p className="landing-notice">{landingNotice}</p> : null}

            <button
              type="button"
              className="primary-action"
              onClick={(event) => {
                event.preventDefault();
                openFilePicker();
              }}
            >
              Choose EPUB
            </button>
          </label>
        </section>
      </section>
    </main>
  );
}
