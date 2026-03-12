# AGENTS.md

## Scope

These instructions apply only to the `audio-ebook-site/` project.

## Project overview

This is a Vite + React + TypeScript app for reading local EPUB files in the browser.

Current behavior:

- upload a local `.epub`
- route to `/reader`
- render the book full-screen with `epub.js`
- paginate with left/right arrow keys and side navigation buttons
- show reader chrome on hover/focus

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

## Working conventions

- Keep changes local to this app.
- Prefer TypeScript where practical.
- Avoid adding heavy dependencies unless clearly needed.
- Preserve the current full-screen reading flow unless the task explicitly changes it.
- When changing UI or reader behavior, verify with `npm run build`.
