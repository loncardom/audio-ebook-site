import path from "node:path";
import fs from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = __dirname;
const parentRoot = path.resolve(projectRoot, "..");

type AutoBootCandidate = {
  label: string;
  bookTitle: string;
  epubPath: string;
  audioPath: string | null;
  timelinePath: string | null;
};

const AUTOBOOT_CANDIDATES: AutoBootCandidate[] = [
  {
    label: "audiobook-epub-sync workspace",
    bookTitle: "The Last Question",
    epubPath: "audiobook-epub-sync/_OceanofPDF.com_The_Last_Question_-_Isaac_Asimov.epub",
    audioPath:
      "audiobook-epub-sync/The Last Question - Isaac Asimov - Read by Leonard Nimoy - Cool Psycho Facts (128k).mp3",
    timelinePath: "audiobook-epub-sync/book_timeline.json"
  },
  {
    label: "legacy workspace sample",
    bookTitle: "book",
    epubPath: "book.epub",
    audioPath: "asr_0_300s.mp3",
    timelinePath: "book_timeline.json"
  }
];

function toFsUrl(absPath: string): string {
  const normalized = absPath.replace(/\\/g, "/");
  return `/@fs${normalized.startsWith("/") ? normalized : `/${normalized}`}`;
}

function timelineOptionsForDirectory(absDir: string) {
  if (!fs.existsSync(absDir)) {
    return [];
  }

  return fs
    .readdirSync(absDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /timeline.*\.json$/i.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => ({
      label: entry.name,
      timelineUrl: toFsUrl(path.join(absDir, entry.name))
    }));
}

function resolveDevAutoBootManifest() {
  const publicAutoloadDir = path.join(projectRoot, "public", "autoload");
  const publicEpubPath = path.join(publicAutoloadDir, "book.epub");
  if (fs.existsSync(publicEpubPath)) {
    const publicAudioPath = path.join(publicAutoloadDir, "book.mp3");
    return {
      label: "audio-ebook-site public autoload",
      bookTitle: "book",
      epubUrl: "/autoload/book.epub",
      audioUrl: fs.existsSync(publicAudioPath) ? "/autoload/book.mp3" : null,
      timelineUrl: null,
      timelineOptions: fs
        .readdirSync(publicAutoloadDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /timeline.*\.json$/i.test(entry.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => ({
          label: entry.name,
          timelineUrl: `/autoload/${entry.name}`
        }))
    };
  }

  for (const candidate of AUTOBOOT_CANDIDATES) {
    const epubAbsPath = path.join(parentRoot, candidate.epubPath);
    if (!fs.existsSync(epubAbsPath)) {
      continue;
    }

    const audioAbsPath = candidate.audioPath ? path.join(parentRoot, candidate.audioPath) : null;
    const timelineAbsPath = candidate.timelinePath ? path.join(parentRoot, candidate.timelinePath) : null;
    const timelineDir = path.dirname(timelineAbsPath ?? epubAbsPath);
    const timelineOptions = timelineOptionsForDirectory(timelineDir);

    return {
      label: candidate.label,
      bookTitle: candidate.bookTitle,
      epubUrl: toFsUrl(epubAbsPath),
      audioUrl: audioAbsPath && fs.existsSync(audioAbsPath) ? toFsUrl(audioAbsPath) : null,
      timelineUrl: timelineOptions[0]?.timelineUrl ?? null,
      timelineOptions
    };
  }

  return null;
}

export default defineConfig({
  define: {
    __PARENT_ASSET_ROOT__: JSON.stringify(parentRoot)
  },
  plugins: [
    react(),
    {
      name: "autoload-manifest",
      configureServer(server) {
        server.middlewares.use("/__autoload_manifest", (_req, res) => {
          const payload = resolveDevAutoBootManifest();
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(payload));
        });
      }
    }
  ],
  server: {
    fs: {
      allow: [parentRoot]
    },
    host: "0.0.0.0",
    port: 5173
  }
});
