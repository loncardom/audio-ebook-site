import type { RelocatedLocation } from "epubjs";

export function locationToPageNumber(
  totalLocations: number,
  currentLocationIndex: number | null
): number {
  if (totalLocations < 1 || currentLocationIndex === null) {
    return 1;
  }

  return Math.min(totalLocations, Math.max(1, currentLocationIndex + 1));
}

export function formatProgress(
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

export function pageNumberLabel(
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

export function chapterLabel(location: RelocatedLocation | null): string {
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

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const rounded = Math.floor(seconds);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
