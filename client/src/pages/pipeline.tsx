import { useQuery } from "@tanstack/react-query";
import { type Company, PIPELINE_STAGES, STAGE_LABELS, type PipelineStage } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from "wouter";
import { Search, Sparkles, Plus } from "lucide-react";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";

const STAGE_ACCENT: Record<PipelineStage, string> = {
  discovered: "#3b82f6",
  researching: "#f59e0b",
  reaching_out: "#a855f7",
  in_diligence: "#10b981",
  passed: "#6b7280",
  invested: "#22c55e",
};

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

  const cs = useCallback(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      bg: `hsl(${s.getPropertyValue("--background").trim()})`,
      fg: `hsl(${s.getPropertyValue("--foreground").trim()})`,
      border: `hsl(${s.getPropertyValue("--border").trim()})`,
      muted: `hsl(${s.getPropertyValue("--muted-foreground").trim()})`,
      card: `hsl(${s.getPropertyValue("--card").trim()})`,
      accent: `hsl(${s.getPropertyValue("--accent").trim()})`,
    };
  }, []);
  const [colors, setColors] = useState(cs);
  useEffect(() => { setColors(cs()); const mo = new MutationObserver(() => setColors(cs())); mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] }); return () => mo.disconnect(); }, [cs]);

  return (
    <div ref={ref} className="flex-1 relative overflow-hidden bg-background">
      {dim.w > 0 && (
        <svg width={dim.w} height={dim.h} className="block" style={{ shapeRendering: "crispEdges" }}>
          {stages.map(({ stage, rect }) => (
            <g key={`s-${stage}`}>
              <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill="none" stroke={colors.border} strokeWidth={1} />
              {rect.w > 50 && (
                <text
                  x={rect.x + 6}
                  y={rect.y + 12}
                  fill={STAGE_ACCENT[stage]}
                  fontSize={9}
                  fontWeight={600}
                  fontFamily="ui-monospace, SFMono-Regular, 'SF Mono', monospace"
                  letterSpacing="0.1em"
                >
                  {STAGE_LABELS[stage].toUpperCase()}
                </text>
              )}
              {rect.w > 30 && (
                <text
                  x={rect.x + rect.w - 6}
                  y={rect.y + 12}
                  fill={colors.muted}
                  fontSize={9}
                  fontFamily="ui-monospace, SFMono-Regular, 'SF Mono', monospace"
                  textAnchor="end"
                  opacity={0.6}
                >
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
            const showSector = cw > 70 && ch > 34;
            const showDesc = cw > 100 && ch > 50;
            const maxChars = Math.floor((cw - 10) / 5.5);

            return (
              <g
                key={company.id}
                className="cursor-pointer"
                onClick={() => navigate(`/companies/${company.id}`)}
                onMouseEnter={() => setHovered(company.id)}
                onMouseLeave={() => setHovered(null)}
                data-testid={`treemap-cell-${company.id}`}
              >
                <rect
                  x={rect.x + px}
                  y={rect.y + px}
                  width={cw}
                  height={ch}
                  fill={isH ? colors.accent : colors.card}
                  stroke={colors.border}
                  strokeWidth={1}
                />
                {isH && (
                  <line
                    x1={rect.x + px}
                    y1={rect.y + px}
                    x2={rect.x + px}
                    y2={rect.y + px + ch}
                    stroke={accent}
                    strokeWidth={2}
                  />
                )}
                <clipPath id={`c-${company.id}`}>
                  <rect x={rect.x + px + 5} y={rect.y + px + 3} width={cw - 10} height={ch - 6} />
                </clipPath>
                <g clipPath={`url(#c-${company.id})`}>
                  <text
                    x={rect.x + px + 7}
                    y={rect.y + px + (ch < 24 ? ch / 2 + 3.5 : 15)}
                    fill={colors.fg}
                    fontSize={cw > 90 ? 11 : cw > 60 ? 10 : 8}
                    fontWeight={500}
                    fontFamily="system-ui, -apple-system, sans-serif"
                    opacity={isH ? 1 : 0.85}
                  >
                    {company.name.length > maxChars + 2 ? company.name.slice(0, maxChars) + "…" : company.name}
                  </text>
                  {showSector && company.sector && (
                    <text
                      x={rect.x + px + 7}
                      y={rect.y + px + 28}
                      fill={colors.muted}
                      fontSize={9}
                      fontFamily="ui-monospace, SFMono-Regular, 'SF Mono', monospace"
                      opacity={0.7}
                    >
                      {company.sector}
                    </text>
                  )}
                  {showDesc && company.oneLiner && (
                    <text
                      x={rect.x + px + 7}
                      y={rect.y + px + 41}
                      fill={colors.muted}
                      fontSize={9}
                      fontFamily="system-ui, -apple-system, sans-serif"
                      opacity={0.4}
                    >
                      {company.oneLiner.length > maxChars ? company.oneLiner.slice(0, maxChars) + "…" : company.oneLiner}
                    </text>
                  )}
                </g>
              </g>
            );
          })}
        </svg>
      )}
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
      <div className="flex-1 px-6 pb-6">
        <TreemapView byStage={byStage} />
      </div>
    </div>
  );
}
