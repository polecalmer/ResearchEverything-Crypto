import { db } from "./db";
import { usageEvents } from "@shared/schema";

export function trackEvent(userId: string | null | undefined, event: string, metadata?: Record<string, any>) {
  db.insert(usageEvents).values({
    userId: userId || null,
    event,
    metadata: metadata || null,
  }).execute().catch((err) => {
    console.error("[UsageTracker] Failed to log event:", event, err.message);
  });
}
