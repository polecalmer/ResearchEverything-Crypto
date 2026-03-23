import { useEffect, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";

export function useTrackPageView(page: string, metadata?: Record<string, any>) {
  const tracked = useRef(false);
  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    apiRequest("POST", "/api/track", { event: "page_view", metadata: { page, ...metadata } }).catch(() => {});
  }, [page]);
}

export function trackAction(event: string, metadata?: Record<string, any>) {
  apiRequest("POST", "/api/track", { event, metadata }).catch(() => {});
}
