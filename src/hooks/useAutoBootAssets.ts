import { useEffect, useRef, type MutableRefObject } from "react";
import { resolveAutoBootAssetSet, type TimelineOption } from "../lib/assets";
import { debugLog } from "../lib/debug";
import { fetchArrayBuffer, fetchTimeline } from "../lib/readerFiles";
import type { TimelineEntry } from "../lib/timeline";

type AutoBootPayload = {
  bookTitle: string;
  bookData: ArrayBuffer;
  audioUrl: string | null;
  timelineEntries: TimelineEntry[];
  timelineOptions: TimelineOption[];
  selectedTimelineUrl: string | null;
};

type UseAutoBootAssetsArgs = {
  enabled: boolean;
  appActiveRef: MutableRefObject<boolean>;
  onStart: (bookTitle: string) => void;
  onNoAssets: () => void;
  onReady: (payload: AutoBootPayload) => void;
  onError: (error: unknown) => void;
};

export function useAutoBootAssets({
  enabled,
  appActiveRef,
  onStart,
  onNoAssets,
  onReady,
  onError
}: UseAutoBootAssetsArgs) {
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (attemptedRef.current || !enabled) {
      return;
    }

    attemptedRef.current = true;
    void resolveAutoBootAssetSet()
      .then(async (assets) => {
        if (!assets) {
          debugLog("autoboot:no-assets");
          onNoAssets();
          return;
        }

        debugLog("autoboot:start", assets);
        onStart(assets.bookTitle);

        const initialTimelineUrl = assets.timelineOptions[0]?.timelineUrl ?? assets.timelineUrl;
        const [bookData, timelineEntries] = await Promise.all([
          fetchArrayBuffer(assets.epubUrl),
          initialTimelineUrl ? fetchTimeline(initialTimelineUrl) : Promise.resolve([])
        ]);

        if (!appActiveRef.current) {
          debugLog("autoboot:ignored-inactive");
          return;
        }

        debugLog("autoboot:assets-ready", {
          bookBytes: bookData.byteLength,
          timelineEntries: timelineEntries.length,
          audioUrl: assets.audioUrl
        });

        onReady({
          bookTitle: assets.bookTitle,
          bookData,
          audioUrl: assets.audioUrl,
          timelineEntries,
          timelineOptions: assets.timelineOptions,
          selectedTimelineUrl: initialTimelineUrl
        });
      })
      .catch((error) => {
        if (!appActiveRef.current) {
          debugLog("autoboot:error-ignored-inactive", error);
          return;
        }

        debugLog("autoboot:failed", error);
        onError(error);
      });
  }, [appActiveRef, enabled, onError, onNoAssets, onReady, onStart]);
}
