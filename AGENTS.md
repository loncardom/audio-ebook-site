# AGENTS.md

## Scope

These instructions apply only to the `audio-ebook-site/` project.

## Project overview

This is a Vite + React + TypeScript app for reading local EPUB files in the browser.

Current behavior:

- in dev, auto-load a default EPUB, audio file, and sync table from the parent directory when available
- upload a local `.epub`
- route to `/reader`
- render the book full-screen with `epub.js`
- paginate with left/right arrow keys and side navigation buttons
- show reader chrome on hover/focus
- play synced audio from the bottom control bar
- scrub audio position with the player slider
- highlight the currently spoken word using the sync table
- seek the audio by clicking words in the rendered EPUB when a matching or nearby sync entry exists

## Working files

Primary files:

- `src/App.tsx`
- `src/styles.css`
- `src/types/epubjs.d.ts`
- `package.json`
- `vite.config.ts`

## Commands

Run from `audio-ebook-site/`:

```bash
npm install
npm run dev
npm run build
```

## EPUB integration notes

- Use `epub.js` for rendering.
- Local file loading should use binary data:
  - `FileReader`
  - `book.open(arrayBuffer, "binary")`
- Do not switch back to a simple blob URL open path for uploaded books unless it is verified to work for local EPUBs in this app.

## Reader behavior notes

- `/reader` is a client-side route only.
- Reloading `/reader` is not persistence-safe yet because the uploaded file is held in memory.
- Arrow key navigation must keep working even when focus is inside the EPUB iframe.
- Hover/focus should reveal the title bar, page indicator, and side navigation.
- The bottom reader layer now also contains audio playback UI.
- Current sync is based on the first audio chunk and its timing table, not a full-book audio implementation.

## Dev asset bootstrap

In local development, the app may auto-load parent-directory assets through Vite's `/@fs/...` file serving.

Current default filenames:

- `../book.epub`
- `../asr_0_300s.mp3`
- `../book_timeline.json`

If these files are unavailable or fail to load, the app should fall back to the manual EPUB upload screen instead of hard-failing.

Do not assume this parent-directory auto-load path is production-safe. It is a dev convenience only.

## Expected content formats

### EPUB

Expected shape:

- a valid `.epub` file
- loaded as binary data (`ArrayBuffer`)
- opened with `book.open(arrayBuffer, "binary")`

Notes:

- Uploaded EPUBs currently only provide reading behavior by themselves.
- Sync behavior depends on separate audio and timing assets that correspond to the same book/content.

### Audio

Expected shape:

- a browser-playable audio file, currently `.mp3`
- for current sync behavior, the app is wired to `asr_0_300s.mp3`
- current implementation assumes a partial audio chunk, roughly the first 300 seconds

Notes:

- The current UI supports play/pause, scrubbing, and click-to-seek against the loaded timing table.
- Do not assume arbitrary uploaded audio will sync unless a matching timing table is also supplied.

### Sync table

Expected shape:

- JSON array
- each item should look like:

```json
{
  "start": 18.19,
  "end": 18.25,
  "word": "A",
  "spoken": "a",
  "spine": 1,
  "cfi": "spine=1;href=OEBPS/section.xhtml;path=html > body > p:nth-of-type(1);w=0"
}
```

Required fields for the current frontend behavior:

- `start`: number, audio start time in seconds
- `end`: number, audio end time in seconds
- `word`: string, display/alignment token
- `cfi`: string, custom extractor reference

Important:

- The `cfi` field in this project is not a standard EPUB CFI.
- It is a custom word locator string with this effective structure:
  - `spine=<number>`
  - `href=<epub document path>`
  - `path=<CSS-like DOM path inside that document>`
  - `w=<word index within the extracted target node>`
- Reader highlighting and click-to-seek currently depend on this custom locator format.

Compatibility expectations:

- `href` should correspond to the rendered EPUB document path.
- `path` should resolve via `querySelector(...)` in the rendered EPUB iframe.
- `w` should identify a spoken word position within the target node, though the UI may fall back to nearest aligned words when exact matches are missing.

## Working conventions

- Keep changes local to this app.
- Prefer TypeScript where practical.
- Avoid adding heavy dependencies unless clearly needed.
- Preserve the current full-screen reading flow unless the task explicitly changes it.
- When changing UI or reader behavior, verify with `npm run build`.
