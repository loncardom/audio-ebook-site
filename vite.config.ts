import path from "node:path";
import fs from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = __dirname;
const parentRoot = path.resolve(projectRoot, "..");
const samplesRoot = path.join(projectRoot, "samples");

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

function resolveSampleManifest() {
  if (!fs.existsSync(samplesRoot)) {
    return [];
  }

  return fs
    .readdirSync(samplesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const sampleDir = path.join(samplesRoot, entry.name);
      const files = fs.readdirSync(sampleDir, { withFileTypes: true }).filter((item) => item.isFile());
      const epubFile = files.find((item) => item.name.toLowerCase().endsWith(".epub"));
      const audioFile = files.find((item) => item.name.toLowerCase().endsWith(".mp3"));
      const timelineOptions = timelineOptionsForDirectory(sampleDir);

      if (!epubFile || !audioFile || timelineOptions.length === 0) {
        return null;
      }

      return {
        label: entry.name,
        bookTitle: entry.name,
        epubUrl: toFsUrl(path.join(sampleDir, epubFile.name)),
        audioUrl: toFsUrl(path.join(sampleDir, audioFile.name)),
        timelineUrl: timelineOptions[0]?.timelineUrl ?? null,
        timelineOptions
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((a, b) => a.bookTitle.localeCompare(b.bookTitle));
}

export default defineConfig({
  define: {
    __PARENT_ASSET_ROOT__: JSON.stringify(parentRoot)
  },
  plugins: [
    react(),
    {
      name: "sample-manifest",
      configureServer(server) {
        server.middlewares.use("/__sample_manifest", (_req, res) => {
          const payload = resolveSampleManifest();
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(payload));
        });
      }
    }
  ],
  server: {
    fs: {
      allow: [parentRoot, samplesRoot]
    },
    host: "0.0.0.0",
    port: 5173
  }
});
