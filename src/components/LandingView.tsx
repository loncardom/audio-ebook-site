import type { ReaderController } from "../hooks/useReaderController";
import { BookIcon, UploadIcon } from "./icons";

type LandingViewProps = Pick<
  ReaderController,
  | "inputRef"
  | "isDragging"
  | "landingNotice"
  | "handleInputChange"
  | "handleDrop"
  | "loadSampleBook"
  | "openFilePicker"
  | "sampleBooks"
  | "setIsDragging"
>;

export function LandingView(props: LandingViewProps) {
  const {
    inputRef,
    isDragging,
    landingNotice,
    handleInputChange,
    handleDrop,
    loadSampleBook,
    openFilePicker,
    sampleBooks,
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
              <p className="brand-name">Audio EPUB Reader</p>
              <span className="brand-subtitle">Syncronize audiobooks with EPUBs</span>
            </div>
          </div>
        </header>

        <section className="landing-hero">
          <div className="landing-copy">
            <h1>Load a book, its audiobook, and the sync map together.</h1>
            <p className="landing-lede">
              Upload all three files to open a synchronized reading session with
              playback, scrubbing, and word highlighting.
            </p>

            <div className="landing-stats">
              <div className="stat-card">
                <strong>EPUB</strong>
                <span>The source text for the reader</span>
              </div>
              <div className="stat-card">
                <strong>MP3</strong>
                <span>The audiobook audio track</span>
              </div>
              <div className="stat-card">
                <strong>JSON</strong>
                <span>The word-to-text sync table</span>
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
              multiple
              accept=".epub,.mp3,.json,application/epub+zip,audio/mpeg,application/json"
              onChange={handleInputChange}
            />

            <div className="upload-icon-wrap">
              <UploadIcon />
            </div>
            <span className="upload-badge">Upload 3 Files</span>
            <strong>Drag and drop an EPUB, MP3, and JSON file here</strong>
            <p>
              The upload set must include exactly what the reader needs: the book,
              its audio, and the sync table that maps them together.
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
              Choose Files
            </button>
          </label>
        </section>

        <section className="samples-section">
          <div className="samples-header">
            <h2>Samples</h2>
            <p>Books from the local <code>samples/</code> directory with an EPUB, MP3, and JSON.</p>
          </div>

          {sampleBooks.length ? (
            <div className="samples-grid">
              {sampleBooks.map((sample) => (
                <button
                  key={sample.label}
                  type="button"
                  className="sample-card"
                  onClick={() => void loadSampleBook(sample)}
                >
                  <strong>{sample.bookTitle}</strong>
                  <span>{sample.timelineOptions[0]?.label ?? "book_timeline.json"}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="samples-empty">
              No complete sample books were found in <code>samples/</code>.
            </p>
          )}
        </section>
      </section>
    </main>
  );
}
