import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  Send, Plus, Trash2, Loader2, MessageSquare,
  CheckCircle2, ChevronDown, Brain, Search, BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveContainer,
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  ComposedChart,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { format } from "date-fns";

const CHART_COLORS = [
  "hsl(217 91% 60%)", "hsl(142 71% 45%)", "hsl(262 83% 58%)",
  "hsl(24 95% 53%)", "hsl(349 89% 60%)", "hsl(47 96% 53%)",
  "hsl(189 94% 43%)", "hsl(322 81% 43%)",
];

interface Artifact {
  type: "chart" | "table" | "metric_cards";
  title: string;
  data: any[];
  chartConfig?: {
    chartType: string;
    xAxis: { dataKey: string; label?: string; format?: string };
    yAxes: Array<{ dataKey: string; label?: string; format?: string; chartType?: string }>;
  };
  columns?: string[];
}

interface SessionMessage {
  id: number;
  conversationId: number;
  role: string;
  content: string;
  artifacts?: Artifact[] | null;
  createdAt: string;
}

interface Session {
  id: number;
  userId: string;
  title: string;
  type: string;
  createdAt: string;
}

function formatValue(val: any, fmt?: string): string {
  if (val == null) return "—";
  const n = Number(val);
  if (isNaN(n)) return String(val);
  if (fmt === "currency") {
    if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
    return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
  if (fmt === "percent") return `${n.toFixed(2)}%`;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function InlineChart({ artifact }: { artifact: Artifact }) {
  const { chartConfig, data, title } = artifact;
  if (!chartConfig || !data?.length) return null;

  const { chartType, xAxis, yAxes } = chartConfig;

  const isDate = xAxis.format === "date" || (data[0]?.[xAxis.dataKey] && /^\d{4}-\d{2}/.test(String(data[0][xAxis.dataKey])));

  const xTickFormatter = (val: any) => {
    if (isDate) {
      try { return format(new Date(val), "MMM ''yy"); } catch { return val; }
    }
    return formatValue(val, xAxis.format);
  };

  const tooltipLabelFormatter = (val: any) => {
    if (isDate) {
      try { return format(new Date(val), "MMM d, yyyy"); } catch { return val; }
    }
    return String(val);
  };

  const tooltipFormatter = (value: any, name: string) => {
    const ax = yAxes.find(y => y.dataKey === name);
    return [formatValue(value, ax?.format), ax?.label || name.replace(/_/g, " ")];
  };

  const needsDualAxis = yAxes.length > 1 && yAxes[0]?.format !== yAxes[1]?.format;

  const renderChart = () => {
    const commonProps = { data, margin: { top: 8, right: needsDualAxis ? 52 : 16, left: 0, bottom: 4 } };
    const grid = <CartesianGrid strokeDasharray="2 6" stroke="var(--color-chart-grid)" vertical={false} />;
    const xAx = (
      <XAxis
        dataKey={xAxis.dataKey}
        tickFormatter={xTickFormatter}
        tick={{ fontSize: 9, fill: "var(--color-chart-tick)" }}
        axisLine={false}
        tickLine={false}
      />
    );
    const tip = (
      <Tooltip
        allowEscapeViewBox={{ x: false, y: true }}
        offset={16}
        contentStyle={{
          backgroundColor: "var(--color-tooltip-bg)",
          border: "1px solid var(--color-tooltip-border)",
          borderRadius: "8px", fontSize: "12px", padding: "8px 12px",
          color: "var(--color-tooltip-text)",
          backdropFilter: "blur(12px)",
          boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
          pointerEvents: "none",
        }}
        wrapperStyle={{ pointerEvents: "none", zIndex: 50 }}
        labelFormatter={tooltipLabelFormatter}
        formatter={tooltipFormatter}
        cursor={{ fill: "var(--color-chart-cursor)" }}
      />
    );
    const leg = yAxes.length > 1 ? (
      <Legend verticalAlign="top" align="left" height={22} iconType="plainline" iconSize={10}
        wrapperStyle={{ fontSize: "9px", color: "var(--color-tooltip-text)", paddingBottom: "2px" }}
        formatter={(v: string) => { const ax = yAxes.find(y => y.dataKey === v); return ax?.label || v.replace(/_/g, " "); }}
      />
    ) : null;

    if (needsDualAxis || chartType === "composed") {
      return (
        <ComposedChart {...commonProps}>
          {grid}{xAx}
          <YAxis
            yAxisId="left"
            tickFormatter={(v: number) => formatValue(v, yAxes[0]?.format)}
            tick={{ fontSize: 9, fill: CHART_COLORS[0] }}
            axisLine={false}
            tickLine={false}
            width={52}
          />
          {yAxes.length > 1 && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tickFormatter={(v: number) => formatValue(v, yAxes[1]?.format)}
              tick={{ fontSize: 9, fill: CHART_COLORS[1] }}
              axisLine={false}
              tickLine={false}
              width={48}
            />
          )}
          {tip}{leg}
          {yAxes.map((y, i) => {
            const axisId = i === 0 ? "left" : "right";
            const yChartType = y.chartType || (i === 0 ? "bar" : "line");
            if (yChartType === "bar") {
              return <Bar key={y.dataKey} yAxisId={axisId} dataKey={y.dataKey} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[1, 1, 0, 0]} maxBarSize={32} opacity={0.85} />;
            }
            if (yChartType === "area") {
              return <Area key={y.dataKey} yAxisId={axisId} type="monotone" dataKey={y.dataKey} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={1.2} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.08} dot={false} />;
            }
            return <Line key={y.dataKey} yAxisId={axisId} type="monotone" dataKey={y.dataKey} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={1.5} dot={false} activeDot={{ r: 2.5 }} />;
          })}
        </ComposedChart>
      );
    }

    const yAx = (
      <YAxis
        tickFormatter={(v: number) => formatValue(v, yAxes[0]?.format)}
        tick={{ fontSize: 9, fill: "var(--color-chart-tick)" }}
        axisLine={false}
        tickLine={false}
        width={52}
      />
    );

    if (chartType === "bar") {
      return (
        <BarChart {...commonProps}>
          {grid}{xAx}{yAx}{tip}{leg}
          {yAxes.map((y, i) => (
            <Bar key={y.dataKey} dataKey={y.dataKey} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[1, 1, 0, 0]} maxBarSize={32} opacity={0.85} />
          ))}
        </BarChart>
      );
    }
    if (chartType === "area") {
      return (
        <AreaChart {...commonProps}>
          {grid}{xAx}{yAx}{tip}{leg}
          {yAxes.map((y, i) => (
            <Area key={y.dataKey} type="monotone" dataKey={y.dataKey} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={1.2} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.08} dot={false} />
          ))}
        </AreaChart>
      );
    }
    return (
      <LineChart {...commonProps}>
        {grid}{xAx}{yAx}{tip}{leg}
        {yAxes.map((y, i) => (
          <Line key={y.dataKey} type="monotone" dataKey={y.dataKey} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={1.2} dot={false} activeDot={{ r: 2.5, fill: CHART_COLORS[i % CHART_COLORS.length], stroke: "rgba(0,0,0,0.5)", strokeWidth: 1 }} />
        ))}
      </LineChart>
    );
  };

  return (
    <div className="my-3 rounded border border-border/40 bg-card/30 p-3" style={{ overflow: "visible" }}>
      <h4 className="text-[11px] font-medium text-foreground/80 mb-2">{title}</h4>
      <div style={{ overflow: "visible" }}>
        <ResponsiveContainer width="100%" height={220} style={{ overflow: "visible" }}>
          {renderChart()}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function InlineTable({ artifact }: { artifact: Artifact }) {
  const { data, columns, title } = artifact;
  if (!data?.length) return null;

  const cols = columns || Object.keys(data[0]);

  return (
    <div className="my-3 rounded border border-border/40 bg-card/30 overflow-hidden">
      <h4 className="text-[11px] font-medium text-foreground/80 px-3 pt-2 pb-1">{title}</h4>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="border-b border-border/30">
              {cols.map(c => (
                <th key={c} className="px-3 py-1.5 text-left font-medium text-muted-foreground/70 uppercase tracking-wider">{c.replace(/_/g, " ")}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.slice(0, 50).map((row: any, i: number) => (
              <tr key={i} className="border-b border-border/20 last:border-0">
                {cols.map(c => (
                  <td key={c} className="px-3 py-1.5 text-foreground/80 font-mono">{formatValue(row[c])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetricCards({ artifact }: { artifact: Artifact }) {
  const { data, title } = artifact;
  if (!data?.length) return null;

  return (
    <div className="my-3 rounded border border-border/40 bg-card/30 overflow-hidden" data-testid="metric-cards">
      {title && <h4 className="text-[11px] font-medium text-foreground/80 px-3 pt-2 pb-1">{title}</h4>}
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="border-b border-border/30">
              {data.map((card: any, i: number) => (
                <th key={i} className="px-3 py-1.5 text-left font-medium text-muted-foreground/70 uppercase tracking-wider whitespace-nowrap">{card.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border/20">
              {data.map((card: any, i: number) => (
                <td key={i} className="px-3 py-1.5 font-mono font-semibold text-foreground/90 whitespace-nowrap">{card.value}</td>
              ))}
            </tr>
            {data.some((c: any) => c.subtitle) && (
              <tr>
                {data.map((card: any, i: number) => (
                  <td key={i} className="px-3 py-1 text-[8px] text-muted-foreground/50 whitespace-nowrap">{card.subtitle || ""}</td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function parseContentAndArtifacts(content: string, artifacts?: Artifact[] | null): Array<{ type: "text" | "chart" | "table" | "metric_cards"; content?: string; artifact?: Artifact }> {
  const parts: Array<{ type: "text" | "chart" | "table" | "metric_cards"; content?: string; artifact?: Artifact }> = [];
  const regex = /```artifact:(chart|table|metric_cards)\s*\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let artifactIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index).trim();
      if (textBefore) parts.push({ type: "text", content: textBefore });
    }

    const type = match[1] as "chart" | "table" | "metric_cards";
    if (artifacts && artifactIndex < artifacts.length) {
      parts.push({ type, artifact: artifacts[artifactIndex] });
      artifactIndex++;
    } else {
      try {
        const json = JSON.parse(match[2].trim());
        let artifact: Artifact;
        if (type === "chart") {
          artifact = { type: "chart", title: json.title || "Chart", data: json.data || [], chartConfig: { chartType: json.chartType || "line", xAxis: json.xAxis || { dataKey: "date" }, yAxes: json.yAxes || [] } };
        } else if (type === "metric_cards") {
          artifact = { type: "metric_cards", title: json.title || "Metrics", data: json.data || [] };
        } else {
          artifact = { type: "table", title: json.title || "Table", data: json.data || [], columns: json.columns };
        }
        parts.push({ type, artifact });
      } catch {}
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    const remaining = content.slice(lastIndex).trim();
    if (remaining) parts.push({ type: "text", content: remaining });
  }

  if (parts.length === 0 && content.trim()) {
    parts.push({ type: "text", content: content.trim() });
  }

  return parts;
}

function InlineFormatted({ text }: { text: string }) {
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
  return (
    <>
      {parts.map((part, j) => {
        if (part.startsWith("**") && part.endsWith("**"))
          return <strong key={j} className="font-semibold text-foreground/90">{part.slice(2, -2)}</strong>;
        if (part.startsWith("`") && part.endsWith("`"))
          return <code key={j} className="bg-muted/50 px-1 rounded text-[9px]">{part.slice(1, -1)}</code>;
        return <span key={j}>{part}</span>;
      })}
    </>
  );
}

function MarkdownText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        if (line.startsWith("### ")) return <h4 key={i} className="text-[11px] font-semibold text-foreground/90 mt-2"><InlineFormatted text={line.slice(4)} /></h4>;
        if (line.startsWith("## ")) return <h3 key={i} className="text-[12px] font-semibold text-foreground/90 mt-3"><InlineFormatted text={line.slice(3)} /></h3>;
        if (line.startsWith("# ")) return <h2 key={i} className="text-[13px] font-bold text-foreground mt-3"><InlineFormatted text={line.slice(2)} /></h2>;
        if (line.startsWith("- ") || line.startsWith("* ")) return <p key={i} className="text-[10px] text-foreground/80 pl-3">• <InlineFormatted text={line.slice(2)} /></p>;
        if (line.match(/^\d+\.\s/)) return <p key={i} className="text-[10px] text-foreground/80 pl-3"><InlineFormatted text={line} /></p>;
        if (line.startsWith("> ")) return <p key={i} className="text-[10px] text-foreground/60 italic border-l-2 border-border/40 pl-2"><InlineFormatted text={line.slice(2)} /></p>;
        if (line.startsWith("**") && line.endsWith("**")) return <p key={i} className="text-[10px] font-semibold text-foreground/90">{line.slice(2, -2)}</p>;
        if (!line.trim()) return <div key={i} className="h-1" />;

        return (
          <p key={i} className="text-[10px] text-foreground/80 leading-relaxed">
            <InlineFormatted text={line} />
          </p>
        );
      })}
    </div>
  );
}

function MessageBubble({ msg }: { msg: SessionMessage }) {
  const isUser = msg.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end mb-4" data-testid={`msg-user-${msg.id}`}>
        <div className="max-w-[80%] bg-primary/10 rounded-lg px-3 py-2">
          <p className="text-[10px] text-foreground/90">{msg.content}</p>
        </div>
      </div>
    );
  }

  const parts = parseContentAndArtifacts(msg.content, msg.artifacts as Artifact[] | null);

  return (
    <div className="mb-4" data-testid={`msg-assistant-${msg.id}`}>
      <div className="max-w-full">
        {parts.map((part, i) => {
          if (part.type === "text" && part.content) {
            return <MarkdownText key={i} text={part.content} />;
          }
          if (part.type === "metric_cards" && part.artifact) {
            return <MetricCards key={i} artifact={part.artifact} />;
          }
          if (part.type === "chart" && part.artifact) {
            return <InlineChart key={i} artifact={part.artifact} />;
          }
          if (part.type === "table" && part.artifact) {
            return <InlineTable key={i} artifact={part.artifact} />;
          }
          return null;
        })}
      </div>
    </div>
  );
}

interface ThinkingStep {
  type: "thinking" | "tool_start" | "tool_result" | "analyzing" | "complete";
  label: string;
  detail?: string;
  round?: number;
  totalRounds?: number;
  timestamp?: number;
}

function ThinkingPanel({ steps }: { steps: ThinkingStep[] }) {
  const [expanded, setExpanded] = useState(true);
  if (steps.length === 0) return null;

  const latestLabel = steps[steps.length - 1]?.label || "Thinking...";
  const isComplete = steps[steps.length - 1]?.type === "complete";

  return (
    <div className="mb-3 rounded border border-border/30 bg-card/20 overflow-hidden" data-testid="thinking-panel">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded(!expanded)}
        data-testid="button-toggle-thinking"
      >
        {!isComplete && <Loader2 className="h-3 w-3 animate-spin text-primary/60" />}
        {isComplete && <CheckCircle2 className="h-3 w-3 text-emerald-500/70" />}
        <span className="text-[10px] text-foreground/60 flex-1 truncate">{latestLabel}</span>
        <ChevronDown className={`h-3 w-3 text-muted-foreground/40 transition-transform ${expanded ? "" : "-rotate-90"}`} />
      </button>
      {expanded && (
        <div className="px-3 pb-2 space-y-0.5">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-2 py-0.5">
              {step.type === "thinking" && <Brain className="h-3 w-3 text-blue-400/60 mt-0.5 shrink-0" />}
              {step.type === "tool_start" && <Search className="h-3 w-3 text-amber-400/60 mt-0.5 shrink-0" />}
              {step.type === "tool_result" && <CheckCircle2 className="h-3 w-3 text-emerald-400/60 mt-0.5 shrink-0" />}
              {step.type === "analyzing" && <BarChart3 className="h-3 w-3 text-purple-400/60 mt-0.5 shrink-0" />}
              {step.type === "complete" && <CheckCircle2 className="h-3 w-3 text-emerald-500/60 mt-0.5 shrink-0" />}
              <span className="text-[9px] text-foreground/50 leading-relaxed">{step.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SessionResearch() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [pendingUserMsg, setPendingUserMsg] = useState<string | null>(null);
  const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>([]);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const sessionsQuery = useQuery<Session[]>({
    queryKey: ["/api/research/sessions"],
    enabled: !!user,
  });

  const messagesQuery = useQuery<SessionMessage[]>({
    queryKey: [`/api/research/sessions/${activeSessionId}/messages`],
    enabled: !!activeSessionId,
  });

  const createSessionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/research/sessions", {});
      return res.json();
    },
    onSuccess: (session: Session) => {
      setActiveSessionId(session.id);
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

  const sendStreamingMessage = useCallback(async (sessionId: number, message: string) => {
    setIsSending(true);
    setThinkingSteps([]);

    try {
      const authHeaders = await getAuthHeaders();
      const headers: Record<string, string> = { "Content-Type": "application/json", ...authHeaders };

      const res = await fetch(`/api/research/sessions/${sessionId}/messages`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ message }),
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
            // SSE comment/keepalive — ignore
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
  }, [toast]);

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const sessions = sessionsQuery.data || [];
  const messages = messagesQuery.data || [];

  const suggestedQueries = [
    "Compare TVL growth of Aave vs Compound vs Morpho over the last year",
    "Show me Hyperliquid's derivatives volume trend",
    "Which DEXs have the highest revenue in the last 30 days?",
    "What's the P/E ratio trend for Ethereum L2s?",
  ];

  return (
    <div className="flex h-[calc(100vh-48px)]" data-testid="session-research-page">
      <div className="w-56 border-r border-border/30 flex flex-col bg-card/20 shrink-0">
        <div className="p-3 border-b border-border/30">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-[10px] h-7 gap-1.5"
            onClick={() => { setActiveSessionId(null); }}
            data-testid="button-new-session"
          >
            <Plus className="h-3 w-3" />
            New Session
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessions.map(s => (
            <div
              key={s.id}
              className={`group flex items-center gap-1.5 px-3 py-2 cursor-pointer border-b border-border/10 transition-colors ${
                activeSessionId === s.id ? "bg-primary/5" : "hover:bg-muted/30"
              }`}
              onClick={() => setActiveSessionId(s.id)}
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
            <p className="text-[9px] text-muted-foreground/40 text-center py-8 px-3">No sessions yet. Start a new research session.</p>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {!activeSessionId && messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full max-w-lg mx-auto">
              <h2 className="text-[14px] font-semibold text-foreground/90 mb-1">Session Research</h2>
              <p className="text-[10px] text-muted-foreground/60 mb-6 text-center">
                Ask anything about DeFi protocols, on-chain data, or market trends. Charts and tables render inline.
              </p>
              <div className="grid grid-cols-2 gap-2 w-full">
                {suggestedQueries.map((q, i) => (
                  <button
                    key={i}
                    className="text-left text-[10px] text-foreground/60 hover:text-foreground/90 bg-card/40 hover:bg-card/60 rounded border border-border/30 px-3 py-2.5 transition-colors"
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
            <div className="max-w-2xl mx-auto">
              {messages.map(msg => (
                <MessageBubble key={msg.id} msg={msg} />
              ))}
              {pendingUserMsg && isSending && (
                <div className="flex justify-end mb-4" data-testid="msg-user-pending">
                  <div className="max-w-[80%] bg-primary/10 rounded-lg px-3 py-2">
                    <p className="text-[10px] text-foreground/90">{pendingUserMsg}</p>
                  </div>
                </div>
              )}
              {isSending && <ThinkingPanel steps={thinkingSteps} />}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="border-t border-border/30 px-6 py-3 bg-background/80 backdrop-blur">
          <div className="max-w-2xl mx-auto flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
              onKeyDown={handleKeyDown}
              placeholder="Ask about protocols, metrics, or on-chain data..."
              className="flex-1 resize-none rounded border border-border/40 bg-card/30 px-3 py-2 text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30 min-h-[36px] max-h-[120px]"
              rows={1}
              disabled={isSending}
              data-testid="input-research-message"
            />
            <Button
              size="sm"
              className="h-9 w-9 p-0 shrink-0"
              onClick={handleSend}
              disabled={!input.trim() || isSending}
              data-testid="button-send-message"
            >
              {isSending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
