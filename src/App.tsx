import { ChangeEvent, DragEvent, ReactNode, useEffect, useRef, useState } from "react";
import ePub, { Book, RelocatedLocation, Rendition } from "epubjs";

type ReaderStatus = "idle" | "loading" | "ready" | "error";
type RoutePath = "/" | "/reader";

function isEpubFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".epub");
}

function formatProgress(location: RelocatedLocation | null): string {
  if (!location) {
    return "Waiting for first page";
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

function pageNumberLabel(location: RelocatedLocation | null): string {
  const page = location?.start.displayed?.page;
  const total = location?.start.displayed?.total;

  if (page && total) {
    return `${page} of ${total}`;
  }

  return formatProgress(location);
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

export default function App() {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const statusRef = useRef<ReaderStatus>("idle");
  const isTurningPageRef = useRef(false);

  const [routePath, setRoutePath] = useState<RoutePath>(
    window.location.pathname === "/reader" ? "/reader" : "/"
  );
  const [status, setStatus] = useState<ReaderStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isTurningPage, setIsTurningPage] = useState(false);
  const [bookTitle, setBookTitle] = useState("No book loaded");
  const [location, setLocation] = useState<RelocatedLocation | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showReaderUi, setShowReaderUi] = useState(true);

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

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    isTurningPageRef.current = isTurningPage;
  }, [isTurningPage]);

  useEffect(() => {
    const handlePopState = () => {
      setRoutePath(window.location.pathname === "/reader" ? "/reader" : "/");
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      cleanupReader();
    };
  }, []);

  useEffect(() => {
    if (routePath !== "/reader" || !pendingFile || !viewerRef.current) {
      return;
    }

    const nextFile = pendingFile;
    setPendingFile(null);
    void loadBook(nextFile);
  }, [routePath, pendingFile]);

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
  }, [routePath, status, isTurningPage]);

  useEffect(() => {
    if (routePath !== "/reader") {
      return;
    }

    const hideUi = () => setShowReaderUi(false);
    const showUi = () => setShowReaderUi(true);
    const timeoutId = window.setTimeout(hideUi, 2200);

    const resetTimer = () => {
      window.clearTimeout(timeoutId);
      showUi();
    };

    window.addEventListener("mousemove", resetTimer);
    window.addEventListener("pointerdown", showUi);
    window.addEventListener("keydown", showUi);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener("mousemove", resetTimer);
      window.removeEventListener("pointerdown", showUi);
      window.removeEventListener("keydown", showUi);
    };
  }, [routePath, location, status]);

  function navigate(path: RoutePath) {
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
    setRoutePath(path);
  }

  function closeReader() {
    cleanupReader();
    setPendingFile(null);
    setStatus("idle");
    setErrorMessage("");
    setLocation(null);
    setBookTitle("No book loaded");
    navigate("/");
  }

  function cleanupReader() {
    if (renditionRef.current) {
      renditionRef.current.destroy();
      renditionRef.current = null;
    }

    if (bookRef.current) {
      bookRef.current.destroy();
      bookRef.current = null;
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }

  async function loadBook(file: File) {
    if (!isEpubFile(file)) {
      setStatus("error");
      setErrorMessage("Please upload a valid .epub file.");
      return;
    }

    if (!viewerRef.current) {
      setStatus("error");
      setErrorMessage("Reader viewport is unavailable.");
      return;
    }

    cleanupReader();
    viewerRef.current.innerHTML = "";

    setStatus("loading");
    setErrorMessage("");
    setBookTitle(file.name.replace(/\.epub$/i, ""));
    setLocation(null);
    setShowReaderUi(true);

    try {
      const bookData = await readFileAsArrayBuffer(file);
      const book = ePub();
      await book.open(bookData, "binary");
      const rendition = book.renderTo(viewerRef.current, {
        width: "100%",
        height: "100%",
        spread: "none",
        flow: "paginated",
        manager: "default"
      });
      (rendition as Rendition & {
        themes?: { fontSize: (size: string) => void };
      }).themes?.fontSize("112%");

      const handleRelocated = (nextLocation: RelocatedLocation) => {
        setLocation(nextLocation);
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

      await rendition.display();
      setStatus("ready");
    } catch (error) {
      cleanupReader();
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "The EPUB could not be opened."
      );
    }
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

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
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

    setPendingFile(file);
    navigate("/reader");
  }

  function openFilePicker() {
    inputRef.current?.click();
  }

  const ready = status === "ready";
  const pageLabel = pageNumberLabel(location);
  const completion =
    typeof location?.percentage === "number"
      ? Math.max(0, Math.min(100, Math.round(location.percentage * 100)))
      : 0;

  if (routePath === "/reader") {
    return (
      <main
        className={`reader-screen ${showReaderUi ? "reader-ui-visible" : ""}`}
        onPointerMove={() => setShowReaderUi(true)}
        onClick={() => setShowReaderUi(true)}
      >
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
                      : "Parsing chapters and preparing paginated pages."}
                  </span>
                </div>
              </div>
            ) : null}

            <div
              ref={viewerRef}
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
            <div className="reader-progress-chip">
              <span>{pageLabel}</span>
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
                <strong>Local upload</strong>
                <span>binary file loading with no remote storage</span>
              </div>
              <div className="stat-card">
                <strong>Reader chrome</strong>
                <span>top controls, side paddles, bottom progress</span>
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
