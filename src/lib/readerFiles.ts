import { debugLog } from "./debug";
import type { TimelineEntry } from "./timeline";

export async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
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

export async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
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

export async function fetchTimeline(url: string): Promise<TimelineEntry[]> {
  debugLog("fetchTimeline:start", { url });
  const response = await fetch(url);
  debugLog("fetchTimeline:response", { url, ok: response.ok, status: response.status });
  if (!response.ok) {
    throw new Error(`Failed to load ${url}`);
  }

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    debugLog("fetchTimeline:invalid-shape", {
      url,
      payloadType: payload === null ? "null" : typeof payload
    });
    return [];
  }

  const filtered = payload.filter(
    (entry): entry is TimelineEntry => {
      if (typeof entry !== "object" || entry === null) {
        return false;
      }

      const candidate = entry as Partial<TimelineEntry>;
      return typeof candidate.cfi === "string" && candidate.cfi.length > 0;
    }
  );
  debugLog("fetchTimeline:done", { url, total: payload.length, usable: filtered.length });
  return filtered;
}
