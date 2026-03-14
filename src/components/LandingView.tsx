import type { ReaderController } from "../hooks/useReaderController";
import { BookIcon, UploadIcon } from "./icons";

type LandingViewProps = Pick<
  ReaderController,
  | "bookAuthor"
  | "bookCoverUrl"
  | "bookDescription"
  | "bookTitle"
  | "inputRef"
  | "isDragging"
  | "landingNotice"
  | "handleInputChange"
  | "handleDrop"
  | "openFilePicker"
  | "setIsDragging"
>;

export function LandingView(props: LandingViewProps) {
  const {
    bookAuthor,
    bookCoverUrl,
    bookDescription,
    bookTitle,
    inputRef,
    isDragging,
    landingNotice,
    handleInputChange,
    handleDrop,
    openFilePicker,
    setIsDragging
  } = props;

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
              <p className="brand-name">Audio ePub Reader</p>
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
                <span>dev mode can boot a sibling workspace EPUB automatically</span>
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

            {bookCoverUrl || (bookTitle && bookTitle !== "No book loaded") ? (
              <div className="book-preview">
                {bookCoverUrl ? (
                  <img className="book-preview-cover" src={bookCoverUrl} alt="" aria-hidden="true" />
                ) : null}
                <div className="book-preview-copy">
                  <strong>{bookTitle}</strong>
                  {bookAuthor ? <span>{bookAuthor}</span> : null}
                  {bookDescription ? (
                    <p>{bookDescription.slice(0, 160)}{bookDescription.length > 160 ? "..." : ""}</p>
                  ) : null}
                </div>
              </div>
            ) : null}

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
