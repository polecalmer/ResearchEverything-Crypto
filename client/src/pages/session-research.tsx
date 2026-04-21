import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Send, Plus, Trash2, Loader2, MessageSquare, FileText, FlaskConical, BarChart3, RefreshCw, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import {
  type ResearchMode, type Session, type SessionMessage, type ThinkingStep,
  SUGGESTED_QUERIES, SUGGESTED_DATA_QUERIES,
} from "@/lib/research-utils";
import {
  MessageBubble, DiveDeepButton, ThinkingPanel, ShareBar, InlineChart,
} from "@/components/research-artifacts";

export default function SessionResearch() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [pendingUserMsg, setPendingUserMsg] = useState<string | null>(null);
  const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"sessions" | "models" | "charts">("sessions");
  const [sessionMode, setSessionMode] = useState<"research" | "data">("research");
  const [selectedChartId, setSelectedChartId] = useState<string | null>(null);
  const [refreshingChartId, setRefreshingChartId] = useState<string | null>(null);
  const [targetMessageId, setTargetMessageId] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  const sendStreamingMessage = useCallback(async (sessionId: number, message: string, opts?: { forceMode?: ResearchMode; refreshBrain?: boolean }) => {
    setIsSending(true);
    setThinkingSteps([]);

    try {
      const authHeaders = await getAuthHeaders();
      const headers: Record<string, string> = { "Content-Type": "application/json", ...authHeaders };

      const res = await fetch(`/api/research/sessions/${sessionId}/messages`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ message, forceMode: opts?.forceMode, refreshBrain: opts?.refreshBrain, sessionMode }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Request failed" }));
        throw new Error(err.message);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";
      let gotDone = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
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
                throw new Error(data.message || "Research failed");
              }
            } catch (e: any) {
              if (currentEvent === "error") throw e;
            }
            currentEvent = "";
          } else if (line.startsWith(":")) {
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: [`/api/research/sessions/${sessionId}/messages`] });
      queryClient.invalidateQueries({ queryKey: ["/api/research/sessions"] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Research failed", variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: [`/api/research/sessions/${sessionId}/messages`] });
      queryClient.invalidateQueries({ queryKey: ["/api/research/sessions"] });
    } finally {
      setPendingUserMsg(null);
      setIsSending(false);
    }
  }, [toast, sessionMode]);

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

  const handleDiveDeep = useCallback((selectedText: string) => {
    if (!activeSessionId || isSending) return;
    const diveMsg = `Dive deeper into this specific section. Provide more detailed analysis, supporting data, and nuance:\n\n"${selectedText}"`;
    setPendingUserMsg(diveMsg);
    sendStreamingMessage(activeSessionId, diveMsg);
  }, [activeSessionId, isSending, sendStreamingMessage]);

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
      toast({ title: "Saved to Reports", description: `Report "${data.title}" created. View it in your reports.` });
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
    <div className="flex h-[calc(100vh-48px)]" data-testid="session-research-page">
      <div className="w-56 border-r border-border/30 flex flex-col bg-card/20 shrink-0">
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
                  data-testid={`session-item-${s.id}`}
                >
                  <MessageSquare className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                  <span className="text-[10px] text-foreground/70 truncate flex-1">{s.title}</span>
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

      <div className="flex-1 flex flex-col min-w-0">
        <div className="border-b border-border/30 px-4 py-2 flex items-center justify-between bg-card/10">
          <div className="flex items-center gap-1 bg-muted/30 rounded-md p-0.5" data-testid="session-mode-toggle">
            {([
              { key: "research" as const, label: "Research", icon: FlaskConical },
              { key: "data" as const, label: "Chart", icon: BarChart3 },
            ]).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setSessionMode(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-medium transition-all ${
                  sessionMode === key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground/60 hover:text-foreground/80"
                }`}
                data-testid={`session-mode-${key}`}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>
          {activeSessionId && messages.length > 0 && (
            <ShareBar sessionId={activeSessionId} session={sessions.find(s => s.id === activeSessionId)} />
          )}
        </div>
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
            <div className="flex flex-col items-center justify-center h-full max-w-lg mx-auto">
              <h2 className="text-lg font-bold text-foreground/90 mb-2">
                {sessionMode === "data" ? "Chart Mode" : "Sessions"}
              </h2>
              <p className="text-sm text-muted-foreground/60 mb-8 text-center leading-relaxed">
                {sessionMode === "data"
                  ? "Build charts, visualize on-chain data, and create dashboards. Every chart becomes a saveable artifact."
                  : "Ask anything about DeFi protocols, on-chain data, or market trends. Charts and tables render inline."}
              </p>
              <div className="grid grid-cols-2 gap-3 w-full">
                {(sessionMode === "data" ? SUGGESTED_DATA_QUERIES : SUGGESTED_QUERIES).map((q, i) => (
                  <button
                    key={i}
                    className="text-left text-[13px] text-foreground/60 hover:text-foreground/90 bg-card/40 hover:bg-card/60 rounded-lg border border-border/30 hover:border-border/50 px-4 py-3 transition-colors leading-relaxed"
                    onClick={() => {
                      setInput(q);
                      inputRef.current?.focus();
                    }}
                    data-testid={`suggested-query-${i}`}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto">
              <DiveDeepButton onDiveDeep={handleDiveDeep} />
              {messages.map((msg, idx) => {
                const isLast = idx === messages.length - 1 && msg.role === "assistant";
                const lastUserMsg = [...messages].reverse().find(m => m.role === "user")?.content;
                return (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    isLast={isLast}
                    busy={isSending}
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
              {pendingUserMsg && isSending && (
                <div className="flex justify-end mb-5" data-testid="msg-user-pending">
                  <div className="max-w-[80%] bg-primary/10 rounded-xl px-4 py-3">
                    <p className="text-[13px] text-foreground/90">{pendingUserMsg}</p>
                  </div>
                </div>
              )}
              {isSending && <ThinkingPanel steps={thinkingSteps} />}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="border-t border-border/30 px-8 py-4 bg-background/80 backdrop-blur">
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
              placeholder={sessionMode === "data" ? "Build a chart, query data, or create a visualization..." : "Ask about protocols, metrics, or on-chain data..."}
              className="flex-1 resize-none rounded-lg border border-border/40 bg-card/30 px-4 py-3 text-[13px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30 min-h-[44px] max-h-[140px]"
              rows={1}
              disabled={isSending}
              data-testid="input-research-message"
            />
            <Button
              size="sm"
              className="h-10 w-10 p-0 shrink-0 rounded-lg"
              onClick={handleSend}
              disabled={!input.trim() || isSending}
              data-testid="button-send-message"
            >
              {isSending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
