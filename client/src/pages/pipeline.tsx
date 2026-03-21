import { useQuery } from "@tanstack/react-query";
import { type Company, PIPELINE_STAGES, STAGE_LABELS, type PipelineStage } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from "wouter";
import { Search, Sparkles, Plus } from "lucide-react";
import { useState, useMemo, useRef, useEffect } from "react";

const STAGE_ACCENT: Record<PipelineStage, string> = {
  discovered: "#3b82f6",
  researching: "#f59e0b",
  reaching_out: "#a855f7",
  in_diligence: "#10b981",
  passed: "#6b7280",
  invested: "#22c55e",
};

function excitementFill(score: number | null | undefined, isDark: boolean, base: string, isToken: boolean): string {
  if (!score) return base;
  const blueDark: Record<number, string> = {
    1: "#181c2a", 2: "#181e2e", 3: "#182032",
    4: "#172438", 5: "#16283e", 6: "#152c44",
    7: "#14304c", 8: "#133454", 9: "#12385c", 10: "#113c64",
  };
  const blueLight: Record<number, string> = {
    1: "#f0f4fa", 2: "#ecf0f8", 3: "#e8ecf6",
    4: "#e2e8f4", 5: "#dce4f2", 6: "#d4def0",
    7: "#ccd8ee", 8: "#c4d2ec", 9: "#bcccec", 10: "#b4c6ec",
  };
  const greenDark: Record<number, string> = {
    1: "#181e1a", 2: "#18201c", 3: "#18221e",
    4: "#162620", 5: "#142a22", 6: "#122e24",
    7: "#103426", 8: "#0e3a28", 9: "#0c402a", 10: "#0a462c",
  };
  const greenLight: Record<number, string> = {
    1: "#f0f6f0", 2: "#ecf4ec", 3: "#e8f2e8",
    4: "#e0f0e0", 5: "#d8eed8", 6: "#d0ecd0",
    7: "#c8eac8", 8: "#c0e8c0", 9: "#b8e6b8", 10: "#b0e4b0",
  };
  const palette = isToken ? (isDark ? blueDark : blueLight) : (isDark ? greenDark : greenLight);
  return palette[score] || base;
}

function excitementBorder(score: number | null | undefined, isDark: boolean, isToken: boolean): string | null {
  if (!score || score < 4) return null;
  if (isToken) {
    if (score <= 6) return isDark ? "#2a3a5a" : "#90a8d4";
    if (score <= 8) return isDark ? "#2a4a7a" : "#6090c8";
    return isDark ? "#2a5a9a" : "#4080c0";
  }
  if (score <= 6) return isDark ? "#2a4a3a" : "#90c8a8";
  if (score <= 8) return isDark ? "#1e5a3a" : "#60b880";
  return isDark ? "#1e7a4a" : "#50c870";
}

function excitementScoreColor(score: number, isDark: boolean, isToken: boolean): string {
  if (isToken) {
    if (score <= 3) return isDark ? "#7090b0" : "#506080";
    if (score <= 6) return isDark ? "#5090c0" : "#3070b0";
    if (score <= 8) return isDark ? "#40a0e0" : "#2080c0";
    return isDark ? "#50b0f0" : "#1070d0";
  }
  if (score <= 3) return isDark ? "#709080" : "#506050";
  if (score <= 6) return isDark ? "#50a070" : "#308050";
  if (score <= 8) return isDark ? "#40b060" : "#209040";
  return isDark ? "#30c050" : "#10a030";
}

interface Rect { x: number; y: number; w: number; h: number }

function squarify(values: number[], rect: Rect): Rect[] {
  if (values.length === 0) return [];
  if (values.length === 1) return [{ ...rect }];
  const total = values.reduce((s, v) => s + v, 0);
  if (total === 0) return values.map(() => ({ ...rect, w: 0, h: 0 }));
  const rects: Rect[] = [];
  let remaining = [...values];
  let cur = { ...rect };
  while (remaining.length > 0) {
    const remTotal = remaining.reduce((s, v) => s + v, 0);
    const wide = cur.w >= cur.h;
    const side = wide ? cur.h : cur.w;
    if (side <= 0 || remTotal <= 0) { remaining.forEach(() => rects.push({ x: cur.x, y: cur.y, w: 0, h: 0 })); break; }
    let row = [remaining[0]], rowT = remaining[0];
    let best = worst(row, side, remTotal, cur);
    for (let i = 1; i < remaining.length; i++) {
      const c = [...row, remaining[i]];
      const w = worst(c, side, remTotal, cur);
      if (w <= best) { row = c; rowT += remaining[i]; best = w; } else break;
    }
    const frac = rowT / remTotal;
    const rs = wide ? cur.w * frac : cur.h * frac;
    let off = 0;
    for (const v of row) {
      const cf = v / rowT, cs = side * cf;
      rects.push(wide ? { x: cur.x, y: cur.y + off, w: rs, h: cs } : { x: cur.x + off, y: cur.y, w: cs, h: rs });
      off += cs;
    }
    if (wide) cur = { x: cur.x + rs, y: cur.y, w: cur.w - rs, h: cur.h };
    else cur = { x: cur.x, y: cur.y + rs, w: cur.w, h: cur.h - rs };
    remaining = remaining.slice(row.length);
  }
  return rects;
}

function worst(row: number[], side: number, total: number, rect: Rect): number {
  const wide = rect.w >= rect.h;
  const sum = row.reduce((s, v) => s + v, 0);
  const rs = (wide ? rect.w : rect.h) * sum / total;
  if (rs <= 0 || side <= 0) return Infinity;
  let w = 0;
  for (const v of row) { const cs = side * v / sum; const r = Math.max(rs / cs, cs / rs); w = Math.max(w, r); }
  return w;
}

interface Cell { company: Company; rect: Rect; stage: PipelineStage }
interface StageRect { stage: PipelineStage; rect: Rect }

function layout(byStage: Record<PipelineStage, Company[]>, W: number, H: number) {
  const stages = PIPELINE_STAGES.filter((s) => byStage[s].length > 0);
  if (!stages.length) return { cells: [] as Cell[], stages: [] as StageRect[] };
  const vals = stages.map((s) => byStage[s].length);
  const sRects = squarify(vals, { x: 0, y: 0, w: W, h: H });
  const cells: Cell[] = [];
  const stageRects: StageRect[] = [];
  stages.forEach((stage, i) => {
    const sr = sRects[i];
    stageRects.push({ stage, rect: sr });
    const cos = byStage[stage];
    const hdr = 18;
    const inner: Rect = { x: sr.x + 1, y: sr.y + hdr, w: Math.max(sr.w - 2, 0), h: Math.max(sr.h - hdr - 1, 0) };
    if (!cos.length) return;
    const cRects = squarify(cos.map(() => 1), inner);
    cos.forEach((c, j) => cells.push({ company: c, rect: cRects[j], stage }));
  });
  return { cells, stages: stageRects };
}

function TreemapView({ byStage }: { byStage: Record<PipelineStage, Company[]> }) {
  const [, navigate] = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ w: 0, h: 0 });
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => { const r = e[0]?.contentRect; if (r) setDim({ w: r.width, h: r.height }); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { cells, stages } = useMemo(() => layout(byStage, dim.w, dim.h), [byStage, dim.w, dim.h]);

  const px = 1;
  const isDark = document.documentElement.classList.contains("dark");
  const C = isDark
    ? { border: "#2a2f42", card: "#181c2a", accent: "#252a3d", fg: "#e8e8e8", muted: "#888fa0" }
    : { border: "#d0d4dd", card: "#f4f5f7", accent: "#e8eaef", fg: "#1c1f26", muted: "#6b7280" };

  return (
    <div className="flex-1 relative min-h-0">
      <div ref={ref} className="absolute inset-0 overflow-hidden bg-background">
        {dim.w > 0 && (
          <svg width={dim.w} height={dim.h} className="block" style={{ shapeRendering: "crispEdges" }}>
            {stages.map(({ stage, rect }) => (
              <g key={`s-${stage}`}>
                <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill="none" stroke={C.border} strokeWidth={1} />
                {rect.w > 50 && (
                  <text x={rect.x + 6} y={rect.y + 12} fill={STAGE_ACCENT[stage]} fontSize={9} fontWeight={600} fontFamily="ui-monospace, SFMono-Regular, 'SF Mono', monospace" letterSpacing="0.1em">
                    {STAGE_LABELS[stage].toUpperCase()}
                  </text>
                )}
                {rect.w > 30 && (
                  <text x={rect.x + rect.w - 6} y={rect.y + 12} fill={C.muted} fontSize={9} fontFamily="ui-monospace, SFMono-Regular, 'SF Mono', monospace" textAnchor="end" opacity={0.6}>
                    {byStage[stage].length}
                  </text>
                )}
              </g>
            ))}
            {cells.map(({ company, rect, stage }) => {
              const isH = hovered === company.id;
              const cw = Math.max(rect.w - px * 2, 0);
              const ch = Math.max(rect.h - px * 2, 0);
              if (cw < 3 || ch < 3) return null;
              const accent = STAGE_ACCENT[stage];
              const es = company.excitementScore;
              const isToken = !!company.hasLiquidToken;
              const cellFill = isH ? C.accent : excitementFill(es, isDark, C.card, isToken);
              const eBorder = excitementBorder(es, isDark, isToken);
              const showSector = cw > 70 && ch > 34;
              const showDesc = cw > 100 && ch > 58;
              const maxChars = Math.floor((cw - 10) / 5.5);
              return (
                <g key={company.id} className="cursor-pointer" onClick={() => navigate(`/companies/${company.id}`)} onMouseEnter={() => setHovered(company.id)} onMouseLeave={() => setHovered(null)} data-testid={`treemap-cell-${company.id}`}>
                  <rect x={rect.x + px} y={rect.y + px} width={cw} height={ch} fill={cellFill} stroke={eBorder || C.border} strokeWidth={eBorder ? 1.5 : 1} />
                  {isH && <line x1={rect.x + px} y1={rect.y + px} x2={rect.x + px} y2={rect.y + px + ch} stroke={accent} strokeWidth={2} />}
                  {es && es >= 7 && ch > 14 && <text x={rect.x + px + cw - 5} y={rect.y + px + 11} fill={excitementScoreColor(es, isDark, isToken)} fontSize={8} fontFamily="ui-monospace, SFMono-Regular, monospace" textAnchor="end" opacity={0.8}>{es}</text>}
                  <clipPath id={`c-${company.id}`}>
                    <rect x={rect.x + px + 5} y={rect.y + px + 3} width={cw - 10} height={ch - 6} />
                  </clipPath>
                  <g clipPath={`url(#c-${company.id})`}>
                    <text x={rect.x + px + 7} y={rect.y + px + (ch < 24 ? ch / 2 + 3.5 : 15)} fill={C.fg} fontSize={cw > 90 ? 11 : cw > 60 ? 10 : 8} fontWeight={500} fontFamily="system-ui, -apple-system, sans-serif" opacity={isH ? 1 : 0.85}>
                      {company.name.length > maxChars + 2 ? company.name.slice(0, maxChars) + "…" : company.name}
                    </text>
                    {showSector && (company.subSector || company.sector) && (
                      <text x={rect.x + px + 7} y={rect.y + px + 28} fill={C.muted} fontSize={9} fontFamily="ui-monospace, SFMono-Regular, 'SF Mono', monospace" opacity={0.7}>
                        {company.subSector || company.sector}
                      </text>
                    )}
                    {company.hasLiquidToken && showSector && !showDesc && (
                      <text x={rect.x + px + 7} y={rect.y + px + 40} fill={isDark ? "#eab308" : "#a16207"} fontSize={8} fontFamily="ui-monospace, SFMono-Regular, monospace" opacity={0.7}>
                        {company.tokenTicker || "Liquid Token"}
                      </text>
                    )}
                  </g>
                  {showDesc && company.oneLiner && (
                    <foreignObject x={rect.x + px + 5} y={rect.y + px + 33} width={cw - 10} height={company.hasLiquidToken ? 16 : 26}>
                      <div style={{ fontSize: 9, fontFamily: "system-ui, -apple-system, sans-serif", color: isH && company.excitementReason ? (es ? excitementScoreColor(es, isDark, isToken) : C.muted) : C.muted, opacity: isH && company.excitementReason ? 0.7 : 0.4, lineHeight: "12px", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: company.hasLiquidToken ? 1 : 2, WebkitBoxOrient: "vertical" as const }}>
                        {isH && company.excitementReason ? company.excitementReason : company.oneLiner}
                      </div>
                    </foreignObject>
                  )}
                  {company.hasLiquidToken && showDesc && (
                    <foreignObject x={rect.x + px + 5} y={rect.y + px + 48} width={cw - 10} height={16}>
                      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                        <span style={{ fontSize: 8, fontFamily: "ui-monospace, SFMono-Regular, monospace", color: isDark ? "#eab308" : "#a16207", opacity: 0.8, border: `1px solid ${isDark ? "rgba(234,179,8,0.25)" : "rgba(161,98,7,0.25)"}`, borderRadius: 3, padding: "1px 4px", display: "inline-flex", alignItems: "center", gap: 2, lineHeight: "12px" }}>
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                          {company.tokenTicker || "Liquid Token"}
                        </span>
                      </div>
                    </foreignObject>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}

export default function Pipeline() {
  const [, navigate] = useLocation();
  const [q, setQ] = useState("");
  const { data: companies = [], isLoading } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const filtered = companies.filter((c) =>
    q ? c.name.toLowerCase().includes(q.toLowerCase()) || c.oneLiner.toLowerCase().includes(q.toLowerCase()) || c.sector?.toLowerCase().includes(q.toLowerCase()) : true
  );
  const byStage = useMemo(() =>
    PIPELINE_STAGES.reduce((a, s) => { a[s] = filtered.filter((c) => c.pipelineStage === s); return a; }, {} as Record<PipelineStage, Company[]>),
    [filtered]
  );

  if (isLoading) return (
    <div className="p-6 h-full flex flex-col">
      <Skeleton className="h-6 w-32 mb-4" />
      <Skeleton className="flex-1" />
    </div>
  );

  if (!companies.length) return (
    <div className="p-6 h-full flex flex-col items-center justify-center">
      <div className="text-center max-w-md">
        <Sparkles className="w-8 h-8 text-muted-foreground mx-auto mb-4 opacity-30" />
        <h2 className="text-lg font-semibold tracking-tight mb-2" data-testid="text-page-title">No deals yet</h2>
        <p className="text-sm text-muted-foreground mb-4">Add your first deal to see the pipeline treemap.</p>
        <Button variant="outline" onClick={() => navigate("/add")} data-testid="button-add-first-deal">
          <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Deal
        </Button>
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-5 pb-3 flex items-end justify-between gap-4 flex-shrink-0">
        <div>
          <h2 className="text-sm font-medium tracking-tight text-foreground" data-testid="text-page-title">Pipeline</h2>
          <span className="text-[10px] font-mono text-muted-foreground">
            {filtered.length} deal{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <input
            type="search"
            placeholder="Filter…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-7 pl-7 pr-2 text-xs bg-transparent border border-border/50 rounded font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-muted-foreground/50 w-36"
            data-testid="input-search-pipeline"
          />
        </div>
      </div>
      <div className="flex-1 px-6 pb-6 flex flex-col min-h-0">
        <TreemapView byStage={byStage} />
      </div>
    </div>
  );
}
