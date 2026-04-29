/**
 * Background tasks context.
 *
 * Tracks long-running agent runs that the user kicks off from inside
 * a session (e.g. highlight → "Build Chart") and continues to read the
 * source memo while the chart builds in another session.
 *
 * The tracker UI (see components/background-tasks-tracker.tsx) reads
 * from this context and renders a floating bottom-right panel with
 * phase progress + click-to-open-memo on completion.
 *
 * Design notes:
 *   - Lives at the app shell level (App.tsx wraps the whole tree) so
 *     navigation between pages doesn't drop in-flight tasks.
 *   - One task per backgrounded session. Multiple parallel tasks are
 *     supported (the tracker stacks them).
 *   - Each task owns its own SSE EventSource subscription. The hook
 *     starts the agent run AND opens the SSE stream in one call.
 *   - Lifecycle: running → complete | failed. After 60s on completion
 *     the task auto-dismisses (UI fades), unless the user has
 *     interacted with the card (clicked "open").
 */

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getAuthHeaders } from "@/lib/queryClient";

export type TaskStatus = "running" | "complete" | "failed";
export type TaskPhase = "understanding" | "planning" | "researching" | "analyzing" | "composing" | "done";

export interface BackgroundTask {
  id: string;                  // local task id (uuid-ish)
  kind: "build-chart" | "double-click"; // drives the Open-link label
  title: string;               // user-facing label, e.g. "Building chart: HYPE TVL"
  sessionId: number;           // the new session created for this task
  msgId?: number;              // assistant msg id once the run completes
  status: TaskStatus;
  phase: TaskPhase;
  phaseLabel: string;          // human-readable current step
  startedAt: number;
  completedAt?: number;
  errorMessage?: string;
  // Click-to-open URL once the assistant message lands.
  memoUrl?: string;
}

export type SpawnKind = "build-chart" | "double-click";

export interface SpawnOptions {
  parentSessionId?: number; // master session that spawned this (fingerprint)
}

interface BackgroundTasksContextValue {
  tasks: BackgroundTask[];
  startBuildChart: (highlightedText: string, opts?: SpawnOptions) => Promise<void>;
  startDoubleClick: (highlightedText: string, opts?: SpawnOptions) => Promise<void>;
  dismissTask: (id: string) => void;
}

const Ctx = createContext<BackgroundTasksContextValue | null>(null);

export function useBackgroundTasks(): BackgroundTasksContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBackgroundTasks must be used inside BackgroundTasksProvider");
  return v;
}

function newTaskId(): string {
  return `bt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildDoubleClickPromptFromHighlight(text: string): string {
  // Same blockquote pattern the in-session Double Click uses — the
  // agent's BASE_PROMPT recognizes this format and applies the
  // double-click discipline (tighter, component-level, focused).
  return `> "${text.trim()}"`;
}

function buildChartPromptFromHighlight(text: string): string {
  // Tight, imperative prompt. Keys to making this work end-to-end:
  //   • Agent MUST emit one artifact:chart code block — not optional.
  //   • If the literal ask isn't fully chartable (data gaps, multi-series
  //     incompatibility, etc.), the agent narrows scope to whatever IS
  //     chartable and explains the scoping decision in the subtitle.
  //     Never bail to prose-only.
  //   • No executive summaries, no scenarios, no multi-section memos.
  //     Subtitle is the only narrative; the chart is the answer.
  return [
    `Build a chart for: "${text.trim()}"`,
    "",
    "REQUIREMENTS (non-negotiable):",
    "  1. Emit EXACTLY ONE artifact:chart code block. The chart IS the deliverable. A response without a chart artifact is broken.",
    "  2. Pick the right entity, metric, and timeframe from the highlighted text. Default to trailing 12 months when the text doesn't specify.",
    "  3. If the literal ask spans multiple incompatible series or partial data: narrow to the most informative single chartable view, and explain the scoping in the subtitle (e.g. 'unlock dispersals only — fee data only available from Apr 2025'). DO NOT skip the chart because the original framing is hard.",
    "  4. Subtitle = ONE all-caps factual takeaway about the chart (≤ 110 chars). No editorializing.",
    "  5. Skip executive summaries, valuation tables, scenario sections, prose paragraphs. This is a single-chart spawn, not a memo. A short 1-3 sentence prose intro is fine if it adds context; longer prose is wrong.",
  ].join("\n");
}

export function BackgroundTasksProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  // EventSource handles per task — closed on dismiss / completion.
  const sourcesRef = useRef<Map<string, EventSource>>(new Map());
  // Auto-dismiss timers for completed tasks.
  const dismissTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    return () => {
      // Cleanup on provider unmount (page close).
      for (const es of sourcesRef.current.values()) es.close();
      for (const t of dismissTimersRef.current.values()) clearTimeout(t);
    };
  }, []);

  const updateTask = (id: string, patch: Partial<BackgroundTask>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const dismissTask = (id: string) => {
    const es = sourcesRef.current.get(id);
    if (es) {
      es.close();
      sourcesRef.current.delete(id);
    }
    const timer = dismissTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      dismissTimersRef.current.delete(id);
    }
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const scheduleAutoDismiss = (id: string, delayMs: number) => {
    const existing = dismissTimersRef.current.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => dismissTask(id), delayMs);
    dismissTimersRef.current.set(id, timer);
  };

  // Internal: shared start primitive for any background-spawned task.
  // Both startBuildChart and startDoubleClick funnel through this. The
  // only differences are: prompt builder, spawnSource label, and
  // sessionMode (chart vs not).
  const startSpawn = async (
    highlightedText: string,
    kind: SpawnKind,
    opts: SpawnOptions = {},
  ): Promise<void> => {
    if (!highlightedText || !highlightedText.trim()) return;
    const taskId = newTaskId();
    const titleSnippet = highlightedText.trim().slice(0, 60);
    const verb = kind === "build-chart" ? "Building chart" : "Double-clicking";
    const placeholderTask: BackgroundTask = {
      id: taskId,
      kind,
      title: `${verb}: ${titleSnippet}${highlightedText.length > 60 ? "…" : ""}`,
      sessionId: 0,
      status: "running",
      phase: "understanding",
      phaseLabel: "Creating session…",
      startedAt: Date.now(),
    };
    setTasks((prev) => [...prev, placeholderTask]);

    try {
      // 1. Create the new session, fingerprinted to the master session.
      const authHeaders = await getAuthHeaders();
      const sessionRes = await fetch("/api/research/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify({
          title: titleSnippet,
          parentSessionId: opts.parentSessionId,
          spawnSource: kind,
        }),
      });
      if (!sessionRes.ok) {
        throw new Error(`Failed to create session: ${sessionRes.status}`);
      }
      const session = await sessionRes.json();
      const sessionId: number = session.id;
      updateTask(taskId, { sessionId, phaseLabel: "Sending prompt…" });

      // 2. Open SSE stream for the agent run by POSTing the message
      const prompt = kind === "build-chart"
        ? buildChartPromptFromHighlight(highlightedText)
        : buildDoubleClickPromptFromHighlight(highlightedText);
      const msgRes = await fetch(`/api/research/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "text/event-stream", ...authHeaders },
        credentials: "include",
        body: JSON.stringify({
          message: prompt,
          // Build Chart needs chart-mode toggle; Double Click stays in
          // focused mode (the BASE_PROMPT rule for blockquote-only
          // messages does the rest).
          ...(kind === "build-chart" ? { sessionMode: "data" } : { forceMode: "focused" }),
        }),
      });
      if (!msgRes.ok || !msgRes.body) {
        throw new Error(`Failed to start agent: ${msgRes.status}`);
      }

      // 3. Stream the SSE response
      const reader = msgRes.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finalMsgId: number | undefined;
      let lastEvent = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            lastEvent = line.slice(7).trim();
            continue;
          }
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (lastEvent === "step") {
                const phase: TaskPhase =
                  data.type === "tool_start" || data.type === "tool_result" ? "researching" :
                  data.type === "thinking" ? "analyzing" :
                  data.type === "complete" ? "composing" :
                  "researching";
                updateTask(taskId, {
                  phase,
                  phaseLabel: String(data.label || data.detail || "Working").slice(0, 80),
                });
              } else if (lastEvent === "message") {
                if (typeof data?.id === "number") finalMsgId = data.id;
              } else if (lastEvent === "done" || lastEvent === "complete") {
                if (typeof data?.msgId === "number") finalMsgId = data.msgId;
              } else if (lastEvent === "error") {
                throw new Error(String(data?.message || "Agent error"));
              }
            } catch {
              // Skip malformed events
            }
          }
        }
      }

      // 4. If we don't have a msgId from events, query the DB for the
      //    most recent assistant message in this session. Best-effort.
      if (!finalMsgId) {
        try {
          const msgsRes = await fetch(`/api/research/sessions/${sessionId}/messages`, {
            credentials: "include",
            headers: { ...authHeaders },
          });
          if (msgsRes.ok) {
            const msgs = await msgsRes.json();
            const lastAssistant = [...msgs].reverse().find((m: any) => m.role === "assistant");
            if (lastAssistant?.id) finalMsgId = lastAssistant.id;
          }
        } catch {}
      }

      // Always open the live session view (not the print-styled memo).
      // The session-research page reads `?sessionId=N` to bootstrap into
      // a specific session — must match that param name exactly or the
      // page lands on the workbench/landing instead.
      const memoUrl = `/research?sessionId=${sessionId}`;
      updateTask(taskId, {
        status: "complete",
        phase: "done",
        phaseLabel: "Done — click to open",
        msgId: finalMsgId,
        memoUrl,
        completedAt: Date.now(),
      });
      // Auto-dismiss 60s after completion (user can interact in the meantime).
      scheduleAutoDismiss(taskId, 60_000);
    } catch (err: any) {
      updateTask(taskId, {
        status: "failed",
        phase: "done",
        phaseLabel: "Failed",
        errorMessage: err?.message || String(err),
        completedAt: Date.now(),
      });
      scheduleAutoDismiss(taskId, 30_000);
    }
  };

  const startBuildChart = (text: string, opts?: SpawnOptions) =>
    startSpawn(text, "build-chart", opts);
  const startDoubleClick = (text: string, opts?: SpawnOptions) =>
    startSpawn(text, "double-click", opts);

  return (
    <Ctx.Provider value={{ tasks, startBuildChart, startDoubleClick, dismissTask }}>
      {children}
    </Ctx.Provider>
  );
}
