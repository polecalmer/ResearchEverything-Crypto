/**
 * Floating bottom-right tracker for background-spawned agent runs
 * (highlight → "Build Chart" today, more action types later). Reads
 * from BackgroundTasksContext and stacks one card per active task.
 *
 * Cards show:
 *   - running: spinner + current phase label + dismiss (X)
 *   - complete: checkmark + "Open chart" button + dismiss (X)
 *   - failed: alert icon + error message + dismiss (X)
 *
 * Position: fixed bottom-right, max-width 340px, vertical stack.
 * Lives at the app shell level so navigation doesn't drop in-flight
 * tasks.
 */

import { Loader2, Check, AlertCircle, X, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { useBackgroundTasks } from "@/contexts/background-tasks";

export function BackgroundTasksTracker() {
  const { tasks, dismissTask } = useBackgroundTasks();

  if (tasks.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-[340px] w-[340px]"
      data-testid="background-tasks-tracker"
    >
      {tasks.map((t) => (
        <div
          key={t.id}
          className="rounded-lg border border-border/60 bg-popover/95 backdrop-blur-md shadow-lg p-3 text-xs animate-in fade-in slide-in-from-bottom-2 duration-200"
          data-testid={`bg-task-${t.id}`}
        >
          <div className="flex items-start gap-2">
            <div className="mt-0.5 shrink-0">
              {t.status === "running" && (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary/80" />
              )}
              {t.status === "complete" && (
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              )}
              {t.status === "failed" && (
                <AlertCircle className="w-3.5 h-3.5 text-destructive" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-foreground/90 truncate" title={t.title}>
                {t.title}
              </div>
              <div className="text-[11px] text-muted-foreground/80 mt-0.5 truncate">
                {t.status === "failed" && t.errorMessage
                  ? t.errorMessage
                  : t.phaseLabel}
              </div>
              {t.status === "complete" && t.memoUrl && (
                <Link
                  href={t.memoUrl}
                  className="inline-flex items-center gap-1 mt-1.5 text-[11px] text-primary hover:underline"
                  data-testid={`bg-task-open-${t.id}`}
                >
                  <ExternalLink className="w-3 h-3" />
                  {t.kind === "build-chart" ? "Open chart" : "Open response"}
                </Link>
              )}
            </div>
            <button
              onClick={() => dismissTask(t.id)}
              className="shrink-0 -mt-0.5 -mr-0.5 p-1 rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent transition"
              aria-label="Dismiss"
              data-testid={`bg-task-dismiss-${t.id}`}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
