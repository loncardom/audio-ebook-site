import type { ReaderController } from "../hooks/useReaderController";
import { IconButton } from "./IconButton";
import {
  BookmarkIcon,
  ExpandIcon,
  HomeIcon,
  MenuIcon,
  MoonIcon,
  PauseIcon,
  PlayIcon,
  SearchIcon,
  SettingsIcon,
  StatsIcon
} from "./icons";

type ReaderViewProps = Pick<
  ReaderController,
  | "audioRef"
  | "audioSrc"
  | "bookTitle"
  | "chapter"
  | "closeReader"
  | "completion"
  | "currentTime"
  | "duration"
  | "errorMessage"
  | "handleScrub"
  | "handleViewerRef"
  | "isDarkMode"
  | "isSpreadLayout"
  | "isPlaying"
  | "isTurningPage"
  | "pageLabel"
  | "playerTimeLabel"
  | "ready"
  | "setCurrentTime"
  | "setDuration"
  | "setIsPlaying"
  | "setShowReaderUi"
  | "showReaderUi"
  | "status"
  | "syncActiveWord"
  | "togglePlayback"
  | "toggleDarkMode"
  | "turnPage"
>;

export function ReaderView(props: ReaderViewProps) {
  const {
    audioRef,
    audioSrc,
    bookTitle,
    chapter,
    closeReader,
    completion,
    currentTime,
    duration,
    errorMessage,
    handleScrub,
    handleViewerRef,
    isDarkMode,
    isSpreadLayout,
    isPlaying,
    isTurningPage,
    pageLabel,
    playerTimeLabel,
    ready,
    setCurrentTime,
    setDuration,
    setIsPlaying,
    setShowReaderUi,
    showReaderUi,
    status,
    syncActiveWord,
    togglePlayback,
    toggleDarkMode,
    turnPage
  } = props;

  return (
    <main
      className={`reader-screen ${showReaderUi ? "reader-ui-visible" : ""} ${isDarkMode ? "dark-mode" : ""}`}
      onPointerMove={() => setShowReaderUi(true)}
      onClick={() => setShowReaderUi(true)}
    >
      <audio
        ref={audioRef}
        src={audioSrc ?? undefined}
        preload={audioSrc ? "metadata" : "none"}
        onLoadedMetadata={(event) => {
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
        onSeeking={(event) => {
          const nextTime = event.currentTarget.currentTime;
          setCurrentTime(nextTime);
          syncActiveWord(nextTime);
        }}
        onSeeked={(event) => {
          const nextTime = event.currentTarget.currentTime;
          setCurrentTime(nextTime);
          syncActiveWord(nextTime);
        }}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(duration);
          syncActiveWord(duration);
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
            <span className="reader-chapter-title">{chapter}</span>
          </div>

          <div className="reader-toolbar reader-toolbar-right">
            <IconButton
              label="Toggle dark mode"
              active={isDarkMode}
              onClick={toggleDarkMode}
            >
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
          {ready && isSpreadLayout ? <div className="reader-divider" /> : null}

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
            onPointerEnter={() => setShowReaderUi(true)}
            onClick={() => void turnPage("prev")}
          >
            <span className="nav-arrow">‹</span>
          </button>

          <button
            type="button"
            className="nav-button nav-button-next"
            aria-label="Next page"
            disabled={!ready || isTurningPage}
            onPointerEnter={() => setShowReaderUi(true)}
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
                <span className="player-time">{playerTimeLabel}</span>
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
