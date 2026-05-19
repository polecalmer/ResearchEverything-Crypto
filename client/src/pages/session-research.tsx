import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useBackgroundTasks } from "@/contexts/background-tasks";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Send, Plus, Trash2, Loader2, MessageSquare, FileText, FlaskConical, BarChart3, RefreshCw, ArrowLeft, X, Search, Square, Microscope, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import {
  type ResearchMode, type Session, type SessionMessage, type ThinkingStep,
  SUGGESTED_QUERIES,
} from "@/lib/research-utils";
import {
  MessageBubble, DiveDeepButton, ThinkingPanel, ShareBar, InlineChart,
} from "@/components/research-artifacts";
import { SessionSidePanel } from "@/components/session-side-panel";
import { CreditsPill } from "@/components/credits-pill";
import { OutOfCreditsModal } from "@/components/out-of-credits-modal";

export default function SessionResearch() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [location, navigate] = useLocation();
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const urlBootstrapHandledRef = useRef<string>("");
  const [input, setInput] = useState("");
  const [pendingUserMsg, setPendingUserMsg] = useState<string | null>(null);
  const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>([]);
  const [isSending, setIsSending] = useState(false);
  // Scope streaming UI to the session that's actually being streamed —
  // without this, the pendingUserMsg + thinkingSteps appear in WHATEVER
  // session the user is viewing, leaking the running session's transient
  // state into every other chat. The streaming itself runs to completion
  // regardless of navigation (we don't abort on session switch).
  const [streamingSessionId, setStreamingSessionId] = useState<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const userAbortedRef = useRef<boolean>(false);
  const [sidebarTab, setSidebarTab] = useState<"sessions" | "models" | "charts" | "discover">("sessions");
  const [discoverInput, setDiscoverInput] = useState("");
  const DISCOVER_EXAMPLES = ["hyperliquid.xyz", "https://x.com/MorphoLabs", "ethena.fi"];
  const submitDiscover = (value: string) => {
    const v = value.trim();
    if (!v) return;
    navigate(`/add?seed=${encodeURIComponent(v)}`);
  };
  // sessionMode toggle removed 2026-05-19 along with chart mode. Kept
  // a stub here so any remaining derived references (toasts, etc.)
  // compile without churn — always "research" now.
  const sessionMode = "research" as const;
  const [selectedChartId, setSelectedChartId] = useState<string | null>(null);
  const [refreshingChartId, setRefreshingChartId] = useState<string | null>(null);
  const [targetMessageId, setTargetMessageId] = useState<number | null>(null);
  // Out-of-credits modal — populated when the server returns 402 on
  // POST /messages. Body shape matches credit-gate.ts's response.
  const [outOfCreditsState, setOutOfCreditsState] = useState<null | {
    error: "out_of_credits";
    message: string;
    balance: number;
    purchaseOptions: Array<{ sku: string; label: string; priceUsd: number; credits: number }>;
    checkoutEndpoint: string;
  }>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Focus mode: when the user is inside a session or viewing a chart, take
  // over the full viewport (hide sidebar, hide outer app chrome, exit button
  // top-right, Esc to leave). Signals "you've entered the working surface."
  // The `isExiting` flag delays the actual unmount so the exit animation can
  // play — without it, Esc snaps back to the list view instantly.
  const isFocusMode = activeSessionId !== null || selectedChartId !== null;
  // Landing state: no session, no chart, no in-flight messages. The
  // landing pane renders full-width with no right side panel — the
  // session-history shelf moved into the main /library route, so we
  // don't need the in-page sidebar here.
  const isLanding = !activeSessionId && !selectedChartId;
  const [isExiting, setIsExiting] = useState(false);
  const FOCUS_EXIT_DURATION_MS = 220;
  const exitFocusMode = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      setActiveSessionId(null);
      setSelectedChartId(null);
      setTargetMessageId(null);
      setIsExiting(false);
    }, FOCUS_EXIT_DURATION_MS);
  }, []);
  useEffect(() => {
    if (!isFocusMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Don't hijack Esc when user is composing in a textarea/input.
        const target = e.target as HTMLElement | null;
        const composing = target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT");
        if (composing) return;
        e.preventDefault();
        exitFocusMode();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFocusMode, exitFocusMode]);

  // sessionMode localStorage persistence removed 2026-05-19 — chart
  // mode no longer exists, so there's nothing to remember.

  const sessionsQuery = useQuery<Session[]>({
    queryKey: ["/api/research/sessions"],
    enabled: !!user,
  });

  const savedModelsQuery = useQuery<Array<{
    id: number;
    conversationId: number;
    conversationTitle: string;
    createdAt: string;
    preview: string;
  }>>({
    queryKey: ["/api/research/saved-models"],
    enabled: !!user,
  });

  const savedChartsQuery = useQuery<Array<{
    id: string;
    title: string;
    chartType: string;
    chartConfig: string;
    data: string;
    dataSourceConfig: string;
    description: string | null;
    createdAt: string;
    updatedAt: string;
  }>>({
    queryKey: ["/api/research/charts/saved"],
    enabled: !!user,
  });

  const messagesQuery = useQuery<SessionMessage[]>({
    queryKey: [`/api/research/sessions/${activeSessionId}/messages`],
    enabled: !!activeSessionId,
  });

  // Bootstrap from URL params: ?sessionId=N | ?newSession=1 | ?chart=ID
  useEffect(() => {
    if (typeof window === "undefined") return;
    const search = window.location.search;
    if (urlBootstrapHandledRef.current === search) return;
    const params = new URLSearchParams(search);
    const sessionIdParam = params.get("sessionId");
    const newSessionParam = params.get("newSession");
    const chartParam = params.get("chart");
    if (!sessionIdParam && !newSessionParam && !chartParam) return;
    urlBootstrapHandledRef.current = search;

    if (chartParam) {
      setSelectedChartId(chartParam);
      setActiveSessionId(null);
      setSidebarTab("charts");
    } else if (sessionIdParam) {
      const id = parseInt(sessionIdParam, 10);
      if (!isNaN(id)) {
        setActiveSessionId(id);
        setSelectedChartId(null);
        setSidebarTab("sessions");
      }
    } else if (newSessionParam) {
      setActiveSessionId(null);
      setSelectedChartId(null);
      setSidebarTab("sessions");
    }

    // Clear params from URL
    window.history.replaceState({}, "", "/research");
  }, [location]);

  useEffect(() => {
    if (!targetMessageId || messagesQuery.isFetching) return;
    const data = messagesQuery.data;
    if (!data?.some((m) => m.id === targetMessageId)) return;
    const el = document.querySelector(`[data-testid="msg-assistant-${targetMessageId}"]`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("ring-2", "ring-purple-400/40", "rounded");
      setTimeout(() => el.classList.remove("ring-2", "ring-purple-400/40", "rounded"), 2000);
      setTargetMessageId(null);
    }
  }, [targetMessageId, messagesQuery.data, messagesQuery.isFetching]);

  const createSessionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/research/sessions", {});
      return res.json();
    },
    onSuccess: (session: Session) => {
      setActiveSessionId(session.id);
      setSelectedChartId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/research/sessions"] });
    },
    onError: (err: any) => {
      setPendingUserMsg(null);
      setIsSending(false);
      toast({ title: "Error", description: "Failed to create session: " + err.message, variant: "destructive" });
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/research/sessions/${id}`);
    },
    onSuccess: (_, deletedId) => {
      if (activeSessionId === deletedId) setActiveSessionId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/research/sessions"] });
    },
  });

  // Rename mutation — PATCH the session title. Optimistic update on
  // the sessions cache so the new name shows instantly in the sidebar
  // and header before the server roundtrip resolves. Rollback on
  // failure restores the previous title and surfaces a toast.
  const renameSessionMutation = useMutation({
    mutationFn: async ({ id, title }: { id: number; title: string }) => {
      const res = await apiRequest("PATCH", `/api/research/sessions/${id}`, { title });
      return await res.json();
    },
    onMutate: async ({ id, title }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/research/sessions"] });
      const previous = queryClient.getQueryData<Session[]>(["/api/research/sessions"]);
      if (previous) {
        queryClient.setQueryData<Session[]>(
          ["/api/research/sessions"],
          previous.map((s) => (s.id === id ? { ...s, title } : s)),
        );
      }
      return { previous };
    },
    onError: (err: any, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(["/api/research/sessions"], ctx.previous);
      toast({ title: "Rename failed", description: err?.message || "Could not save the new title", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research/sessions"] });
    },
  });

  const sendStreamingMessage = useCallback(async (sessionId: number, message: string, opts?: { forceMode?: ResearchMode; refreshBrain?: boolean }) => {
    setIsSending(true);
    setThinkingSteps([]);
    setStreamingSessionId(sessionId);

    const STREAM_IDLE_MS = 60_000;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    userAbortedRef.current = false;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        controller.abort(new DOMException("Stream idle timeout", "AbortError"));
      }, STREAM_IDLE_MS);
    };

    let gotDone = false;
    let explicitServerError: string | null = null;

    try {
      const authHeaders = await getAuthHeaders();
      const headers: Record<string, string> = { "Content-Type": "application/json", ...authHeaders };

      const res = await fetch(`/api/research/sessions/${sessionId}/messages`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ message, forceMode: opts?.forceMode, refreshBrain: opts?.refreshBrain }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Request failed" }));
        // 402 = out of credits. Surface via the purchase modal instead
        // of a destructive error toast, and DON'T burn the optimistic
        // message — we'll let the user retry after they buy.
        if (res.status === 402 && err?.error === "out_of_credits") {
          setOutOfCreditsState(err);
          throw new Error("OUT_OF_CREDITS");
        }
        throw new Error(err.message);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";

      armIdle();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        armIdle();
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ") && currentEvent) {
            const rawData = line.slice(6);
            try {
              const data = JSON.parse(rawData);
              if (currentEvent === "step") {
                setThinkingSteps(prev => [...prev, { ...data, timestamp: Date.now() }]);
              } else if (currentEvent === "done") {
                gotDone = true;
              } else if (currentEvent === "error") {
                explicitServerError = data.message || "Research failed";
              }
            } catch {}
            currentEvent = "";
          }
        }
      }

      if (explicitServerError) throw new Error(explicitServerError);

      queryClient.invalidateQueries({ queryKey: [`/api/research/sessions/${sessionId}/messages`] });
      queryClient.invalidateQueries({ queryKey: ["/api/research/sessions"] });
    } catch (err: any) {
      const isAbort = err?.name === "AbortError" || /aborted|idle/i.test(err?.message || "");
      const userAborted = userAbortedRef.current;
      const friendly = userAborted
        ? "Stopped. The server may still be completing this in the background — invalidate to refresh later."
        : explicitServerError
          ? explicitServerError
          : isAbort
            ? "Stream connection lost. The research may still be running on the server — refreshing shortly."
            : (err?.message || "Research failed");
      toast({
        title: userAborted ? "Stopped" : explicitServerError ? "Error" : "Connection interrupted",
        description: friendly,
        variant: userAborted ? "default" : "destructive",
      });

      // If the connection dropped (not an explicit server error or user-initiated
      // stop), the server may still be completing the research. Poll the messages
      // endpoint a few times to pick up the final result instead of leaving the
      // user stuck. Skip the poll on user-stop — the user explicitly asked to bail.
      if (!explicitServerError && !gotDone && !userAborted) {
        for (let i = 0; i < 6; i++) {
          await new Promise(r => setTimeout(r, 5000));
          await queryClient.invalidateQueries({ queryKey: [`/api/research/sessions/${sessionId}/messages`] });
          const fresh: any = queryClient.getQueryData([`/api/research/sessions/${sessionId}/messages`]);
          if (Array.isArray(fresh) && fresh.some((m: any) => m.role === "assistant" && new Date(m.createdAt).getTime() > Date.now() - 120_000)) break;
        }
      }

      queryClient.invalidateQueries({ queryKey: [`/api/research/sessions/${sessionId}/messages`] });
      queryClient.invalidateQueries({ queryKey: ["/api/research/sessions"] });
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      abortControllerRef.current = null;
      setPendingUserMsg(null);
      setIsSending(false);
      setStreamingSessionId(null);
    }
  }, [toast, sessionMode]);

  const cancelStreaming = useCallback(() => {
    const ctrl = abortControllerRef.current;
    if (!ctrl) return;
    userAbortedRef.current = true;
    ctrl.abort(new DOMException("User stopped the request", "AbortError"));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesQuery.data, isSending, thinkingSteps]);

  const handleSend = useCallback(() => {
    const msg = input.trim();
    if (!msg || isSending) return;

    setPendingUserMsg(msg);
    setInput("");

    if (!activeSessionId) {
      createSessionMutation.mutate(undefined, {
        onSuccess: (session: Session) => {
          setActiveSessionId(session.id);
          setTimeout(() => sendStreamingMessage(session.id, msg), 100);
        },
      });
    } else {
      sendStreamingMessage(activeSessionId, msg);
    }
  }, [input, activeSessionId, isSending, sendStreamingMessage]);

  // "Double Click" and "Build Chart" both spawn PARALLEL sub-sessions
  // in the background. User stays in the current (master) session and
  // can keep reading; the bottom-right tracker shows progress, and
  // each spawn is fingerprinted to the master via parentSessionId so
  // the future "research journey" view can render parent + children
  // as a cohesive thread. Double Click sends the highlight as a
  // markdown blockquote; the agent's BASE_PROMPT recognizes the
  // pattern and runs in tighter, component-level mode.
  const { startBuildChart, startDoubleClick } = useBackgroundTasks();

  const handleDiveDeep = useCallback((selectedText: string) => {
    if (!activeSessionId) return;
    void startDoubleClick(selectedText, { parentSessionId: activeSessionId });
    toast({
      title: "Double-clicking in background",
      description: "Watch the bottom-right tracker. Keep reading; the deeper read will be ready in ~1-2 min.",
    });
  }, [activeSessionId, startDoubleClick, toast]);

  const handleBuildChart = useCallback((selectedText: string) => {
    if (!activeSessionId) return;
    void startBuildChart(selectedText, { parentSessionId: activeSessionId });
    toast({
      title: "Building chart in background",
      description: "Watch the bottom-right tracker. Open the chart when it's ready.",
    });
  }, [activeSessionId, startBuildChart, toast]);

  const handleContinueAnalysis = useCallback(() => {
    if (!activeSessionId || isSending) return;
    const continueMsg = "Continue where you left off. All data from previous tool calls is in context — synthesize it into the complete analysis now.";
    setPendingUserMsg("Continuing analysis...");
    sendStreamingMessage(activeSessionId, continueMsg);
  }, [activeSessionId, isSending, sendStreamingMessage]);

  const handleAddToReport = useCallback(async (msgId: number) => {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/research/messages/${msgId}/save-to-report`, {
        method: "POST",
        headers: { ...authHeaders },
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed to save" }));
        throw new Error(err.message);
      }
      const data = await res.json();
      toast({ title: "Saved to Library", description: `Memo "${data.title}" saved. Find it under Library → Memos.` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }, [toast]);

  const handleSaveAsModel = useCallback(async (msgId: number, artifactIndex?: number) => {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/research/messages/${msgId}/save-as-model`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify(artifactIndex !== undefined ? { artifactIndex } : {}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed to save" }));
        throw new Error(err.message);
      }
      const data = await res.json();
      toast({ title: "Saved as Model", description: `Model "${data.title}" created.` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
      throw e;
    }
  }, [toast]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const sessions = sessionsQuery.data || [];
  const savedModels = savedModelsQuery.data || [];
  const savedCharts = savedChartsQuery.data || [];
  const messages = messagesQuery.data || [];

  return (
    <div
      className={`${
        isFocusMode
          ? "fixed inset-0 z-50 flex bg-background"
          : "flex h-[calc(100vh-48px)]"
      } ${
        // Shell-level motion: the layer zooms forward into place. The eye has
        // something to track between "list view" and "workspace open" so the
        // entry no longer reads as an instant snap.
        isFocusMode && !isExiting
          ? "animate-in zoom-in-95 duration-500 ease-out"
          : ""
      } ${
        isExiting
          ? "animate-out zoom-out-95 duration-200 ease-in fill-mode-forwards"
          : ""
      }`}
      data-testid="session-research-page"
      data-focus-mode={isFocusMode}
    >
      {/* Sidebar removed — sessions/models/charts now live in the Workbench
          home view (see below). Was previously kept mounted and hidden in
          focus mode; deleting entirely simplifies the layout. */}
      <div className="hidden">
        {/* unmounted */}
      </div>
      {false && (
      <div
        className={`w-56 border-r border-border/30 flex flex-col bg-card/20 shrink-0 ${
          isFocusMode ? "hidden" : ""
        }`}
      >
        <div className="p-3 border-b border-border/30">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-[10px] h-7 gap-1.5"
            onClick={() => { setActiveSessionId(null); setSidebarTab("sessions"); }}
            data-testid="button-new-session"
          >
            <Plus className="h-3 w-3" />
            New Session
          </Button>
        </div>
        <div className="flex border-b border-border/30 text-[9px] uppercase tracking-wider">
          {(["sessions", "models", "charts"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setSidebarTab(tab)}
              className={`flex-1 py-2 transition-colors ${
                sidebarTab === tab
                  ? "text-foreground/90 border-b-2 border-primary/60 -mb-px bg-muted/20"
                  : "text-muted-foreground/50 hover:text-foreground/70"
              }`}
              data-testid={`sidebar-tab-${tab}`}
            >
              {tab === "sessions" ? `Sessions (${sessions.length})` : tab === "models" ? `Models (${savedModels.length})` : `Charts (${savedCharts.length})`}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {sidebarTab === "sessions" && (
            <>
              {sessions.map(s => (
                <div
                  key={s.id}
                  className={`group flex items-center gap-1.5 px-3 py-2 cursor-pointer border-b border-border/10 transition-colors ${
                    activeSessionId === s.id ? "bg-primary/5" : "hover:bg-muted/30"
                  }`}
                  onClick={() => { setActiveSessionId(s.id); setSelectedChartId(null); }}
                  onMouseEnter={() => {
                    // Prefetch messages on hover so the click → render path
                    // hits cache. Eliminates the 400-1000ms fetch wait.
                    queryClient.prefetchQuery({
                      queryKey: [`/api/research/sessions/${s.id}/messages`],
                    });
                  }}
                  data-testid={`session-item-${s.id}`}
                >
                  <MessageSquare className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                  <EditableSessionTitle
                    title={s.title}
                    onCommit={(next) => renameSessionMutation.mutate({ id: s.id, title: next })}
                    variant="sidebar"
                    className="flex-1 min-w-0"
                    testId={`session-title-${s.id}`}
                  />
                  <button
                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-destructive transition-opacity"
                    onClick={(e) => { e.stopPropagation(); deleteSessionMutation.mutate(s.id); }}
                    data-testid={`button-delete-session-${s.id}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {sessions.length === 0 && !sessionsQuery.isLoading && (
                <p className="text-[9px] text-muted-foreground/40 text-center py-8 px-3">No sessions yet. Start a new session.</p>
              )}
            </>
          )}
          {sidebarTab === "models" && (
            <>
              {savedModels.map((m) => (
                <button
                  key={m.id}
                  className="group w-full text-left flex items-start gap-1.5 px-3 py-2 cursor-pointer border-b border-border/10 hover:bg-muted/30 transition-colors"
                  onClick={() => {
                    setActiveSessionId(m.conversationId);
                    setTargetMessageId(m.id);
                  }}
                  data-testid={`saved-model-item-${m.id}`}
                >
                  <FileText className="h-3 w-3 text-purple-400/60 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] text-foreground/85 truncate">{m.preview || m.conversationTitle}</p>
                    <p className="text-[8px] text-muted-foreground/50 mt-0.5">
                      {format(new Date(m.createdAt), "MMM d, yyyy")}
                    </p>
                  </div>
                </button>
              ))}
              {savedModels.length === 0 && !savedModelsQuery.isLoading && (
                <p className="text-[9px] text-muted-foreground/40 text-center py-8 px-3">
                  No saved models yet. Run a deep dive — "build me a model on X" — and it'll show up here.
                </p>
              )}
            </>
          )}
          {sidebarTab === "charts" && (
            <>
              {savedCharts.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { setSelectedChartId(c.id); setActiveSessionId(null); }}
                  className={`group w-full text-left flex items-center gap-1.5 px-3 py-2 border-b border-border/10 hover:bg-muted/30 transition-colors ${
                    selectedChartId === c.id ? "bg-cyan-500/10 border-l-2 border-l-cyan-400/50" : ""
                  }`}
                  data-testid={`saved-chart-item-${c.id}`}
                >
                  <BarChart3 className={`h-3 w-3 shrink-0 ${selectedChartId === c.id ? "text-cyan-400" : "text-cyan-400/60"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] text-foreground/85 truncate">{c.title}</p>
                    <p className="text-[8px] text-muted-foreground/50 mt-0.5">
                      {format(new Date(c.updatedAt || c.createdAt), "MMM d, yyyy")} · {c.chartType}
                    </p>
                  </div>
                  <span
                    role="button"
                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-destructive transition-opacity"
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        const authHeaders = await getAuthHeaders();
                        await fetch(`/api/research/charts/${c.id}`, {
                          method: "DELETE",
                          headers: authHeaders,
                          credentials: "include",
                        });
                        if (selectedChartId === c.id) setSelectedChartId(null);
                        queryClient.invalidateQueries({ queryKey: ["/api/research/charts/saved"] });
                      } catch {}
                    }}
                    data-testid={`button-delete-chart-${c.id}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </span>
                </button>
              ))}
              {savedCharts.length === 0 && !savedChartsQuery.isLoading && (
                <p className="text-[9px] text-muted-foreground/40 text-center py-8 px-3">
                  No saved charts yet. Build a chart and click "Save" to add it here.
                </p>
              )}
            </>
          )}
        </div>
      </div>
      )}

      <div
        className={`flex-1 flex flex-col min-w-0 ${
          // Content lands AFTER the shell zoom — 200ms delay so the user sees
          // the shell move into place first, then the content arrives.
          isFocusMode && !isExiting
            ? "animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out delay-200 fill-mode-both"
            : ""
        } ${
          isExiting ? "animate-out fade-out slide-out-to-bottom-2 duration-150 ease-in fill-mode-forwards" : ""
        }`}
      >
        <div className="border-b border-border/30 px-4 py-2 flex items-center justify-between gap-3 bg-card/10">
          <div className="flex items-center gap-3 min-w-0">
            {/* Research/Chart mode toggle removed 2026-05-19. Chart
                mode was killed — focused/deep produce chart artifacts
                natively, no separate path needed. */}
            {isFocusMode && (
              <div className="min-w-0 flex items-baseline gap-2">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50">
                  {selectedChartId ? "Chart" : "Session"}
                </span>
                {selectedChartId ? (
                  // Charts in the library aren't user-renamable from this
                  // header today — keep static. Only the active session
                  // title is editable here.
                  <span className="text-[12px] text-foreground/80 truncate" data-testid="focus-mode-title">
                    {savedCharts.find(c => c.id === selectedChartId)?.title || "Untitled chart"}
                  </span>
                ) : activeSessionId ? (
                  <EditableSessionTitle
                    title={sessions.find(s => s.id === activeSessionId)?.title || "New session"}
                    onCommit={(next) => renameSessionMutation.mutate({ id: activeSessionId, title: next })}
                    variant="header"
                    className="truncate min-w-0"
                    testId="focus-mode-title"
                  />
                ) : (
                  <span className="text-[12px] text-foreground/80 truncate" data-testid="focus-mode-title">
                    New session
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <CreditsPill />
            {activeSessionId && messages.length > 0 && (
              <ShareBar sessionId={activeSessionId} session={sessions.find(s => s.id === activeSessionId)} />
            )}
            {isFocusMode && (
              <button
                onClick={exitFocusMode}
                className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] uppercase tracking-wider text-muted-foreground/60 hover:text-foreground hover:bg-muted/40 transition-colors"
                title="Exit focus mode (Esc)"
                data-testid="button-exit-focus"
              >
                <X className="h-3 w-3" />
                Exit
                <kbd className="hidden md:inline-block ml-1 px-1 py-0 rounded border border-border/40 text-[9px] text-muted-foreground/50 font-mono">Esc</kbd>
              </button>
            )}
          </div>
        </div>
        {/* Split-screen workspace: 55% chat (left) + 45% side panel (right)
            when a session/chart is active. On the LANDING state (no session,
            no chart, no messages) the left pane goes full-width and the
            right pane is unmounted — see isLanding above. The session
            history shelf lives in the main /library route now, so the
            workbench doesn't double up. */}
        <div className="flex-1 flex min-h-0">
        <div className="flex flex-col min-w-0 min-h-0" style={{ flexBasis: isLanding ? "100%" : "55%", flexGrow: 0, flexShrink: 0 }}>
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {selectedChartId ? (() => {
            const chartRaw = savedCharts.find(c => c.id === selectedChartId);
            if (!chartRaw) return <p className="text-center text-muted-foreground/40 py-20">Chart not found</p>;
            let parsedData: any[] = [];
            let parsedConfig: any = {};
            let dsConfig: any = {};
            try { parsedData = JSON.parse(chartRaw.data || "[]"); } catch {}
            try { parsedConfig = JSON.parse(chartRaw.chartConfig || "{}"); } catch {}
            try { dsConfig = JSON.parse(chartRaw.dataSourceConfig || "{}"); } catch {}
            const hasRecipe = !!dsConfig.refreshRecipe;
            const artifact = {
              type: "chart" as const,
              title: chartRaw.title,
              subtitle: chartRaw.description || undefined,
              source: dsConfig.refreshRecipe?.dataSource || "session",
              data: parsedData,
              chartConfig: parsedConfig,
              refreshRecipe: dsConfig.refreshRecipe,
            };
            return (
              <div className="max-w-3xl mx-auto">
                <div className="flex items-center gap-3 mb-4">
                  <button
                    onClick={() => setSelectedChartId(null)}
                    className="p-1.5 rounded-md hover:bg-muted/30 text-muted-foreground/60 hover:text-foreground/80 transition-colors"
                    data-testid="button-back-from-chart"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-foreground/90 truncate">{chartRaw.title}</h3>
                    <p className="text-[10px] text-muted-foreground/50">
                      Last updated {format(new Date(chartRaw.updatedAt || chartRaw.createdAt), "MMM d, yyyy 'at' HH:mm")}
                      {hasRecipe && ` · ${dsConfig.refreshRecipe.protocol} · ${dsConfig.refreshRecipe.metric}`}
                    </p>
                  </div>
                  {hasRecipe && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={refreshingChartId === chartRaw.id}
                      onClick={async () => {
                        setRefreshingChartId(chartRaw.id);
                        try {
                          const authHeaders = await getAuthHeaders();
                          const res = await fetch(`/api/research/charts/${chartRaw.id}/refresh`, {
                            method: "POST",
                            headers: authHeaders,
                            credentials: "include",
                          });
                          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Refresh failed");
                          const result = await res.json();
                          queryClient.invalidateQueries({ queryKey: ["/api/research/charts/saved"] });
                          toast({ title: "Refreshed", description: `${result.dataPoints} data points in ${(result.refreshTimeMs / 1000).toFixed(1)}s` });
                        } catch (e: any) {
                          toast({ title: "Refresh failed", description: e.message, variant: "destructive" });
                        } finally {
                          setRefreshingChartId(null);
                        }
                      }}
                      className="h-7 text-[10px] gap-1.5 border-cyan-500/20 text-cyan-400/80 hover:bg-cyan-500/10"
                      data-testid="button-refresh-selected-chart"
                    >
                      <RefreshCw className={`h-3 w-3 ${refreshingChartId === chartRaw.id ? "animate-spin" : ""}`} />
                      Refresh Live
                    </Button>
                  )}
                </div>
                <InlineChart artifact={artifact} />
              </div>
            );
          })() : !activeSessionId && messages.length === 0 ? (
            // ─── Workbench ────────────────────────────────────────────────
            // Top half: "Start a session" hero (the input here is the actual
            //           composer — we hide the bottom composer in this state).
            // Bottom half: Library — sessions / models / charts as cards.
            // Both halves animate in with a stagger so the workbench feels
            // composed, not dumped.
            <div className="h-full flex flex-col gap-8 max-w-5xl mx-auto py-8 px-4" data-testid="workbench">
              {/* Hero */}
              <div className="flex-1 flex flex-col items-center justify-center gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out">
                <div className="text-center space-y-2">
                  <h1 className="text-[22px] font-semibold text-foreground/95 tracking-tight">
                    Start a session
                  </h1>
                  <p className="text-[12px] text-muted-foreground/60 max-w-md mx-auto leading-relaxed">
                    Ask anything about crypto.
                  </p>
                </div>

                {/* Hero composer */}
                <div className="w-full max-w-2xl">
                  <div className="relative rounded-xl border border-border/40 bg-card/30 transition-all focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/15 focus-within:bg-card/50">
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={e => {
                        setInput(e.target.value);
                        e.target.style.height = "auto";
                        e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
                      }}
                      onKeyDown={handleKeyDown}
                      placeholder="What do you want to research?"
                      className="w-full resize-none bg-transparent px-5 pt-4 pb-14 text-[14px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none min-h-[110px] max-h-[200px]"
                      rows={3}
                      disabled={isSending}
                      data-testid="workbench-composer"
                    />
                    <div className="absolute bottom-3 right-3 flex items-center gap-2">
                      <span className="hidden md:inline-block text-[10px] text-muted-foreground/40 mr-1">
                        Enter to send · Shift+Enter for newline
                      </span>
                      <Button
                        size="sm"
                        variant={isSending ? "destructive" : "default"}
                        className="h-8 px-3 gap-1.5 rounded-md"
                        onClick={isSending ? cancelStreaming : handleSend}
                        disabled={!isSending && !input.trim()}
                        data-testid={isSending ? "workbench-stop" : "workbench-send"}
                      >
                        {isSending ? <Square className="h-3 w-3 fill-current" /> : <Send className="h-3 w-3" />}
                        {isSending ? "Stop" : "Send"}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Suggested-query pills */}
                <div className="w-full max-w-2xl flex flex-wrap gap-2 justify-center">
                  {SUGGESTED_QUERIES.slice(0, 6).map((q, i) => (
                    <button
                      key={i}
                      className="text-[11px] px-3 py-1.5 rounded-full border border-border/40 bg-card/20 text-muted-foreground/70 hover:text-foreground hover:bg-card/40 hover:border-border/60 transition-colors"
                      onClick={() => { setInput(q); inputRef.current?.focus(); }}
                      data-testid={`suggested-query-${i}`}
                    >
                      {q.length > 70 ? q.slice(0, 70) + "…" : q}
                    </button>
                  ))}
                </div>
              </div>

              {/* Library section removed 2026-05-19: session history,
                  memos, and charts now live in the main /library route
                  (see client/src/pages/library.tsx). The landing here is
                  the hero composer only — full pane, centered. */}
            </div>
          ) : activeSessionId && messages.length === 0 && (messagesQuery.isLoading || messagesQuery.isFetching) ? (
            <div className="flex items-center justify-center h-full" data-testid="messages-loading">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground/50 uppercase tracking-wider">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading conversation
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto">
              <DiveDeepButton onDiveDeep={handleDiveDeep} onBuildChart={handleBuildChart} />
              {/* Research Journey strip: shows the parent session this
                  one was spawned from (if any), and any sub-sessions
                  spawned from this one (Build Chart, Double Click).
                  Lets the user navigate the full research thread
                  instead of treating each spawn as orphaned. */}
              <ResearchJourneyStrip
                activeSessionId={activeSessionId}
                sessions={sessions}
              />
              {/* `isSendingHere` = streaming is active AND it's THIS
                  session being streamed. Without this gate, navigating
                  to a different chat while a session is running shows
                  every other session in a "busy" state and leaks the
                  pending bubble + thinking panel into them. */}
              {(() => null)()}
              {messages.map((msg, idx) => {
                const isLast = idx === messages.length - 1 && msg.role === "assistant";
                const lastUserMsg = [...messages].reverse().find(m => m.role === "user")?.content;
                const isSendingHere = isSending && streamingSessionId === activeSessionId;
                return (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    isLast={isLast}
                    busy={isSendingHere}
                    lastUserMessage={lastUserMsg}
                    onDiveDeep={handleDiveDeep}
                    onAddToReport={handleAddToReport}
                    onSaveAsModel={handleSaveAsModel}
                    onContinue={handleContinueAnalysis}
                    onOverride={(action) => {
                      if (!activeSessionId || !lastUserMsg) return;
                      sendStreamingMessage(activeSessionId, lastUserMsg, action);
                    }}
                  />
                );
              })}
              {/* Streaming UI is scoped to the session that's actually
                  being streamed. Without the streamingSessionId match,
                  navigating to a different session would show the
                  pending message + thinking panel from a still-running
                  OTHER session — leaking state across chats. */}
              {pendingUserMsg && isSending && streamingSessionId === activeSessionId && (
                <div className="flex justify-end mb-5" data-testid="msg-user-pending">
                  <div className="max-w-[80%] bg-primary/10 rounded-xl px-4 py-3">
                    <p className="text-[13px] text-foreground/90">{pendingUserMsg}</p>
                  </div>
                </div>
              )}
              {/* Inline ThinkingPanel removed 2026-05-17: the live progress
                  display now lives in the right side panel (ProgressPanel
                  in session-side-panel.tsx) as a clean phase checklist.
                  Showing both would duplicate the same "agent is working"
                  signal in two places. */}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Hide the bottom composer when we're on the Workbench — the hero
            input is the active composer in that state. Show only when there's
            an active session, a selected chart, or messages already in flight. */}
        {(activeSessionId || selectedChartId || messages.length > 0) && (
        <div className="border-t border-border/30 px-8 py-4 bg-background/80 backdrop-blur" data-section="composer">
          <div className="max-w-3xl mx-auto flex items-end gap-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px";
              }}
              onKeyDown={handleKeyDown}
              placeholder="Ask about protocols, metrics, or on-chain data..."
              className="flex-1 resize-none rounded-lg border border-border/40 bg-card/30 px-4 py-3 text-[13px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30 min-h-[44px] max-h-[140px]"
              rows={1}
              disabled={isSending && streamingSessionId === activeSessionId}
              data-testid="input-research-message"
            />
            <Button
              size="sm"
              variant={isSending && streamingSessionId === activeSessionId ? "destructive" : "default"}
              className="h-10 w-10 p-0 shrink-0 rounded-lg"
              onClick={isSending && streamingSessionId === activeSessionId ? cancelStreaming : handleSend}
              disabled={(isSending && streamingSessionId !== activeSessionId) || (!isSending && !input.trim())}
              data-testid={isSending && streamingSessionId === activeSessionId ? "button-stop-message" : "button-send-message"}
              title={isSending && streamingSessionId === activeSessionId ? "Stop" : (isSending ? "Another session is streaming" : "Send")}
            >
              {isSending && streamingSessionId === activeSessionId ? (
                <Square className="h-4 w-4 fill-current" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
        )}
        </div>
        {/* Right pane: session side panel (artifacts + downloads + iteration).
            Unmounted on the landing state — see isLanding above. Hidden
            via empty-state CSS when a session is active but has no
            artifacts yet — see session-side-panel.tsx. */}
        {!isLanding && (
        <div className="flex flex-col min-w-0" style={{ flexBasis: "45%", flexGrow: 0, flexShrink: 0 }}>
          <SessionSidePanel
            messages={messages}
            isStreaming={isSending && streamingSessionId === activeSessionId}
            thinkingSteps={thinkingSteps}
          />
        </div>
        )}
        </div>
      </div>

      {outOfCreditsState && (
        <OutOfCreditsModal
          open={!!outOfCreditsState}
          message={outOfCreditsState.message}
          balance={outOfCreditsState.balance}
          purchaseOptions={outOfCreditsState.purchaseOptions}
          checkoutEndpoint={outOfCreditsState.checkoutEndpoint}
          onClose={() => setOutOfCreditsState(null)}
        />
      )}
    </div>
  );
}

/* ─── Research Journey Strip ───────────────────────────────────────
 * Renders parent + children of the active session as a small
 * navigable strip above the messages. Surfaces the spawn graph the
 * user built up during their research thread (Build Chart, Double
 * Click). Click any chip → navigate to that session.
 *
 * Hidden when the session has no parent and no children (top-level
 * solo session — no thread to show).
 */

/**
 * Inline-editable session title. Renders as a static span by default;
 * double-click (or click the hover edit icon) flips to an input that
 * commits on Enter/blur and reverts on Esc. Used in both the sidebar
 * session list and the focus-mode header bar — variant prop tunes the
 * typography for each surface.
 *
 * On save, the parent's rename mutation handles the optimistic update
 * + cache invalidation. This component is presentational + interaction
 * only; no network calls live here.
 */
function EditableSessionTitle({
  title,
  onCommit,
  variant = "sidebar",
  className,
  testId,
}: {
  title: string;
  onCommit: (newTitle: string) => void;
  variant?: "sidebar" | "header";
  className?: string;
  testId?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { setDraft(title); }, [title]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== title) onCommit(next);
    setEditing(false);
  };
  const cancel = () => {
    setDraft(title);
    setEditing(false);
  };

  const baseStyles =
    variant === "header"
      ? "text-[12px] text-foreground/80"
      : "text-[10px] text-foreground/70";

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") cancel();
        }}
        onClick={(e) => e.stopPropagation()}
        className={`${baseStyles} bg-background border border-border/60 rounded px-1.5 py-0.5 outline-none focus:border-primary/60 min-w-0 flex-1 ${className || ""}`}
        data-testid={`${testId || "editable-title"}-input`}
        maxLength={200}
      />
    );
  }

  return (
    <span
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      className={`${baseStyles} truncate cursor-text hover:underline decoration-dotted underline-offset-4 ${className || ""}`}
      data-testid={testId || "editable-title"}
      title="Double-click to rename"
    >
      {title}
    </span>
  );
}

function ResearchJourneyStrip({
  activeSessionId,
  sessions,
}: {
  activeSessionId: number | null;
  sessions: Session[];
}) {
  const [, setLocation] = useLocation();
  if (!activeSessionId) return null;
  const active = sessions.find((s) => s.id === activeSessionId);
  if (!active) return null;
  const parent = active.parentSessionId
    ? sessions.find((s) => s.id === active.parentSessionId)
    : null;
  const children = sessions
    .filter((s) => s.parentSessionId === activeSessionId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  if (!parent && children.length === 0) return null;

  const navigate = (id: number) => {
    setLocation(`/research?sessionId=${id}`);
  };

  const sourceIcon = (src?: string | null) => {
    if (src === "build-chart") return <BarChart3 className="w-3 h-3" />;
    if (src === "double-click") return <Microscope className="w-3 h-3" />;
    return <MessageSquare className="w-3 h-3" />;
  };

  return (
    <div
      className="mb-5 -mt-1 px-3 py-2.5 rounded-md border border-border/40 bg-card/40 text-[11px]"
      data-testid="research-journey-strip"
    >
      <div className="flex items-center gap-1.5 text-muted-foreground/70 mb-1.5">
        <GitBranch className="w-3 h-3" />
        <span className="uppercase tracking-wider">Research Journey</span>
      </div>
      {parent && (
        <div className="flex items-center gap-2 mb-1">
          <span className="text-muted-foreground/60">Spawned from:</span>
          <button
            onClick={() => navigate(parent.id)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-foreground/85 bg-background/60 hover:bg-accent transition border border-border/30 max-w-[60ch] truncate"
            data-testid={`journey-parent-${parent.id}`}
            title={parent.title}
          >
            <ArrowLeft className="w-3 h-3 shrink-0" />
            <span className="truncate">{parent.title || `Session ${parent.id}`}</span>
          </button>
        </div>
      )}
      {children.length > 0 && (
        <div className="flex items-start gap-2 flex-wrap">
          <span className="text-muted-foreground/60 pt-0.5">Spawned:</span>
          <div className="flex flex-wrap gap-1.5">
            {children.map((c) => (
              <button
                key={c.id}
                onClick={() => navigate(c.id)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-foreground/85 bg-background/60 hover:bg-accent transition border border-border/30 max-w-[40ch] truncate"
                data-testid={`journey-child-${c.id}`}
                title={`${c.spawnSource || "session"}: ${c.title}`}
              >
                {sourceIcon(c.spawnSource)}
                <span className="truncate">{c.title || `Session ${c.id}`}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
