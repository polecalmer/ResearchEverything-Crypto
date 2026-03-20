import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { type Company, PIPELINE_STAGES, STAGE_LABELS, type PipelineStage } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from "wouter";
import {
  Search,
  Sparkles,
  Plus,
} from "lucide-react";
import { useState, useMemo, useRef, useEffect } from "react";

const STAGE_COLORS: Record<PipelineStage, { bg: string; border: string; text: string; label: string }> = {
  discovered: { bg: "rgba(59,130,246,0.08)", border: "rgba(59,130,246,0.25)", text: "rgb(96,165,250)", label: "rgb(59,130,246)" },
  researching: { bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.25)", text: "rgb(251,191,36)", label: "rgb(245,158,11)" },
  reaching_out: { bg: "rgba(168,85,247,0.08)", border: "rgba(168,85,247,0.25)", text: "rgb(192,132,252)", label: "rgb(168,85,247)" },
  in_diligence: { bg: "rgba(16,185,129,0.08)", border: "rgba(16,185,129,0.25)", text: "rgb(52,211,153)", label: "rgb(16,185,129)" },
  passed: { bg: "rgba(156,163,175,0.06)", border: "rgba(156,163,175,0.2)", text: "rgb(156,163,175)", label: "rgb(107,114,128)" },
  invested: { bg: "rgba(34,197,94,0.10)", border: "rgba(34,197,94,0.3)", text: "rgb(74,222,128)", label: "rgb(34,197,94)" },
};

interface TreeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function squarify(values: number[], rect: TreeRect): TreeRect[] {
  if (values.length === 0) return [];
  if (values.length === 1) return [{ ...rect }];

  const total = values.reduce((s, v) => s + v, 0);
  if (total === 0) return values.map(() => ({ ...rect, w: 0, h: 0 }));

  const rects: TreeRect[] = [];
  let remaining = [...values];
  let currentRect = { ...rect };

  while (remaining.length > 0) {
    const remTotal = remaining.reduce((s, v) => s + v, 0);
    const isWide = currentRect.w >= currentRect.h;
    const side = isWide ? currentRect.h : currentRect.w;

    if (side <= 0 || remTotal <= 0) {
      remaining.forEach(() => rects.push({ x: currentRect.x, y: currentRect.y, w: 0, h: 0 }));
      break;
    }

    let row: number[] = [remaining[0]];
    let rowTotal = remaining[0];
    let bestWorst = worstRatio(row, side, remTotal, currentRect);

    for (let i = 1; i < remaining.length; i++) {
      const candidate = [...row, remaining[i]];
      const candidateTotal = rowTotal + remaining[i];
      const candidateWorst = worstRatio(candidate, side, remTotal, currentRect);
      if (candidateWorst <= bestWorst) {
        row = candidate;
        rowTotal = candidateTotal;
        bestWorst = candidateWorst;
      } else {
        break;
      }
    }

    const rowFraction = rowTotal / remTotal;
    const rowSize = isWide ? currentRect.w * rowFraction : currentRect.h * rowFraction;

    let offset = 0;
    for (const val of row) {
      const cellFraction = val / rowTotal;
      const cellSize = side * cellFraction;
      if (isWide) {
        rects.push({ x: currentRect.x, y: currentRect.y + offset, w: rowSize, h: cellSize });
      } else {
        rects.push({ x: currentRect.x + offset, y: currentRect.y, w: cellSize, h: rowSize });
      }
      offset += cellSize;
    }

    if (isWide) {
      currentRect = { x: currentRect.x + rowSize, y: currentRect.y, w: currentRect.w - rowSize, h: currentRect.h };
    } else {
      currentRect = { x: currentRect.x, y: currentRect.y + rowSize, w: currentRect.w, h: currentRect.h - rowSize };
    }

    remaining = remaining.slice(row.length);
  }

  return rects;
}

function worstRatio(row: number[], side: number, total: number, rect: TreeRect): number {
  const isWide = rect.w >= rect.h;
  const rowSum = row.reduce((s, v) => s + v, 0);
  const rowFraction = rowSum / total;
  const rowSize = isWide ? rect.w * rowFraction : rect.h * rowFraction;
  if (rowSize <= 0 || side <= 0) return Infinity;

  let worst = 0;
  for (const val of row) {
    const cellFraction = val / rowSum;
    const cellSize = side * cellFraction;
    const ratio = Math.max((rowSize * rowSize) / (cellSize * cellSize), (cellSize * cellSize) / (rowSize * rowSize));
    worst = Math.max(worst, ratio);
  }
  return worst;
}

interface TreemapCell {
  company: Company;
  rect: TreeRect;
  stage: PipelineStage;
}

function computeTreemap(
  companiesByStage: Record<PipelineStage, Company[]>,
  width: number,
  height: number
): { cells: TreemapCell[]; stageRects: { stage: PipelineStage; rect: TreeRect }[] } {
  const stages = PIPELINE_STAGES.filter((s) => companiesByStage[s].length > 0);
  if (stages.length === 0) return { cells: [], stageRects: [] };

  const stageValues = stages.map((s) => Math.max(companiesByStage[s].length, 1));
  const stageRects = squarify(stageValues, { x: 0, y: 0, w: width, h: height });

  const cells: TreemapCell[] = [];
  const stageRectsResult: { stage: PipelineStage; rect: TreeRect }[] = [];

  stages.forEach((stage, i) => {
    const sr = stageRects[i];
    stageRectsResult.push({ stage, rect: sr });

    const companies = companiesByStage[stage];
    const padding = 2;
    const headerH = 22;
    const innerRect: TreeRect = {
      x: sr.x + padding,
      y: sr.y + headerH,
      w: Math.max(sr.w - padding * 2, 0),
      h: Math.max(sr.h - headerH - padding, 0),
    };

    if (companies.length === 0) return;

    const companyValues = companies.map(() => 1);
    const companyRects = squarify(companyValues, innerRect);

    companies.forEach((company, j) => {
      cells.push({ company, rect: companyRects[j], stage });
    });
  });

  return { cells, stageRects: stageRectsResult };
}

function TreemapView({ companies, companiesByStage }: { companies: Company[]; companiesByStage: Record<PipelineStage, Company[]> }) {
  const [, navigate] = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { cells, stageRects } = useMemo(
    () => computeTreemap(companiesByStage, dimensions.width, dimensions.height),
    [companiesByStage, dimensions.width, dimensions.height]
  );

  const gap = 2;

  return (
    <div ref={containerRef} className="flex-1 relative rounded-lg border border-border overflow-hidden bg-background">
      {dimensions.width > 0 && (
        <svg width={dimensions.width} height={dimensions.height} className="block">
          {stageRects.map(({ stage, rect }) => {
            const colors = STAGE_COLORS[stage];
            return (
              <g key={`stage-${stage}`}>
                <rect
                  x={rect.x + 1}
                  y={rect.y + 1}
                  width={Math.max(rect.w - 2, 0)}
                  height={Math.max(rect.h - 2, 0)}
                  fill="none"
                  stroke={colors.border}
                  strokeWidth={1}
                  rx={4}
                />
                {rect.w > 60 && rect.h > 20 && (
                  <text
                    x={rect.x + 8}
                    y={rect.y + 15}
                    fill={colors.label}
                    fontSize={9}
                    fontWeight={600}
                    fontFamily="ui-monospace, SFMono-Regular, monospace"
                    letterSpacing="0.08em"
                    textAnchor="start"
                  >
                    {STAGE_LABELS[stage].toUpperCase()} ({companiesByStage[stage].length})
                  </text>
                )}
              </g>
            );
          })}

          {cells.map(({ company, rect, stage }) => {
            const colors = STAGE_COLORS[stage];
            const isHovered = hoveredId === company.id;
            const cellW = Math.max(rect.w - gap * 2, 0);
            const cellH = Math.max(rect.h - gap * 2, 0);
            if (cellW < 2 || cellH < 2) return null;

            const showSector = cellW > 80 && cellH > 40;
            const showOneLiner = cellW > 120 && cellH > 55;
            const maxTextW = cellW - 12;

            return (
              <g
                key={company.id}
                className="cursor-pointer"
                onClick={() => navigate(`/companies/${company.id}`)}
                onMouseEnter={() => setHoveredId(company.id)}
                onMouseLeave={() => setHoveredId(null)}
                data-testid={`treemap-cell-${company.id}`}
              >
                <rect
                  x={rect.x + gap}
                  y={rect.y + gap}
                  width={cellW}
                  height={cellH}
                  fill={isHovered ? colors.border : colors.bg}
                  stroke={colors.border}
                  strokeWidth={isHovered ? 1.5 : 0.5}
                  rx={3}
                  style={{ transition: "fill 0.15s, stroke-width 0.15s" }}
                />
                <clipPath id={`clip-${company.id}`}>
                  <rect x={rect.x + gap + 4} y={rect.y + gap + 2} width={maxTextW} height={cellH - 4} />
                </clipPath>
                <g clipPath={`url(#clip-${company.id})`}>
                  <text
                    x={rect.x + gap + 6}
                    y={rect.y + gap + (cellH < 30 ? cellH / 2 + 4 : 16)}
                    fill={isHovered ? "white" : colors.text}
                    fontSize={cellW > 100 ? 11 : 9}
                    fontWeight={600}
                    fontFamily="system-ui, -apple-system, sans-serif"
                    style={{ transition: "fill 0.15s" }}
                  >
                    {company.name}
                  </text>
                  {showSector && company.sector && (
                    <text
                      x={rect.x + gap + 6}
                      y={rect.y + gap + 30}
                      fill={isHovered ? "rgba(255,255,255,0.7)" : `${colors.text.replace("rgb", "rgba").replace(")", ",0.5)")}`}
                      fontSize={8}
                      fontFamily="ui-monospace, SFMono-Regular, monospace"
                    >
                      {company.sector}
                    </text>
                  )}
                  {showOneLiner && company.oneLiner && (
                    <text
                      x={rect.x + gap + 6}
                      y={rect.y + gap + 43}
                      fill={isHovered ? "rgba(255,255,255,0.5)" : `${colors.text.replace("rgb", "rgba").replace(")", ",0.35)")}`}
                      fontSize={8}
                      fontFamily="system-ui, -apple-system, sans-serif"
                    >
                      {company.oneLiner.length > Math.floor(maxTextW / 4.5) ? company.oneLiner.slice(0, Math.floor(maxTextW / 4.5)) + "…" : company.oneLiner}
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
  const [searchQuery, setSearchQuery] = useState("");

  const { data: companies = [], isLoading } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  const filteredCompanies = companies.filter((c) =>
    searchQuery
      ? c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.oneLiner.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.sector?.toLowerCase().includes(searchQuery.toLowerCase())
      : true
  );

  const companiesByStage = useMemo(() =>
    PIPELINE_STAGES.reduce(
      (acc, stage) => {
        acc[stage] = filteredCompanies.filter((c) => c.pipelineStage === stage);
        return acc;
      },
      {} as Record<PipelineStage, Company[]>
    ),
    [filteredCompanies]
  );

  if (isLoading) {
    return (
      <div className="p-6 h-full flex flex-col">
        <div className="mb-5">
          <Skeleton className="h-7 w-48 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="flex-1 rounded-lg" />
      </div>
    );
  }

  if (companies.length === 0) {
    return (
      <div className="p-6 h-full flex flex-col items-center justify-center">
        <div className="text-center max-w-md">
          <div className="w-14 h-14 rounded-2xl bg-accent flex items-center justify-center mx-auto mb-4">
            <Sparkles className="w-7 h-7 text-foreground" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight mb-2" data-testid="text-page-title">Your Deal Pipeline</h2>
          <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
            Start by adding your first deal. Use the button below or the <strong>Add Deal</strong> page in the sidebar.
          </p>
          <Button onClick={() => navigate("/add")} data-testid="button-add-first-deal">
            <Plus className="w-4 h-4 mr-1.5" />
            Add Your First Deal
          </Button>
        </div>
      </div>
    );
  }

  const activeCount = filteredCompanies.length;

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold tracking-tight" data-testid="text-page-title">Pipeline</h2>
          <p className="text-xs text-muted-foreground mt-0.5 font-mono">
            {activeCount} {activeCount === 1 ? "deal" : "deals"}
            {searchQuery && ` matching "${searchQuery}"`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-3 text-[10px] text-muted-foreground">
            {PIPELINE_STAGES.filter(s => companiesByStage[s].length > 0).map((stage) => (
              <span key={stage} className="flex items-center gap-1 font-mono">
                <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: STAGE_COLORS[stage].label }} />
                {STAGE_LABELS[stage]}
              </span>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="search"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 pr-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring w-44"
              data-testid="input-search-pipeline"
            />
          </div>
        </div>
      </div>

      <TreemapView companies={filteredCompanies} companiesByStage={companiesByStage} />
    </div>
  );
}
