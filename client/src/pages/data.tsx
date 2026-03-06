import { useQuery } from "@tanstack/react-query";
import { type Company, PIPELINE_STAGES, STAGE_LABELS } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart3,
  Building2,
  TrendingUp,
  Target,
  Layers,
  CheckCircle2,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from "lucide-react";

function StatTile({
  label,
  value,
  icon: Icon,
  detail,
  testId,
}: {
  label: string;
  value: string | number;
  icon: any;
  detail?: string;
  testId: string;
}) {
  return (
    <div className="py-4 px-1" data-testid={testId}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</span>
      </div>
      <p className="text-3xl font-bold tracking-tight">{value}</p>
      {detail && <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>}
    </div>
  );
}

function HorizontalBar({
  label,
  count,
  total,
  color,
  testId,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
  testId: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3 py-1.5" data-testid={testId}>
      <span className="text-xs text-muted-foreground w-28 truncate shrink-0">{label}</span>
      <div className="flex-1 h-5 bg-accent/40 rounded-sm overflow-hidden relative">
        {count > 0 && (
          <div
            className={`h-full rounded-sm transition-all duration-500 ${color}`}
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        )}
      </div>
      <span className="text-xs font-medium tabular-nums w-8 text-right shrink-0">{count}</span>
      <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right shrink-0">
        {pct > 0 ? `${pct.toFixed(0)}%` : "—"}
      </span>
    </div>
  );
}

const STAGE_COLORS: Record<string, string> = {
  discovered: "bg-blue-500/70",
  researching: "bg-amber-500/70",
  reaching_out: "bg-purple-500/70",
  in_diligence: "bg-orange-500/70",
  passed: "bg-muted-foreground/40",
  invested: "bg-green-500/70",
};

const SECTOR_COLORS = [
  "bg-blue-500/60",
  "bg-indigo-500/60",
  "bg-violet-500/60",
  "bg-purple-500/60",
  "bg-fuchsia-500/60",
  "bg-pink-500/60",
  "bg-rose-500/60",
  "bg-amber-500/60",
  "bg-emerald-500/60",
  "bg-teal-500/60",
  "bg-cyan-500/60",
  "bg-sky-500/60",
];

export default function DataPage() {
  const { data: companies = [], isLoading } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto h-full overflow-y-auto">
        <Skeleton className="h-6 w-32 mb-2" />
        <Skeleton className="h-4 w-48 mb-8" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mb-10">
          {[1, 2, 3, 4].map((i) => (
            <div key={i}>
              <Skeleton className="h-4 w-20 mb-2" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
        <Skeleton className="h-4 w-40 mb-4" />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-6 w-full mb-2" />
        ))}
      </div>
    );
  }

  const total = companies.length;

  const stageCounts = PIPELINE_STAGES.reduce(
    (acc, stage) => {
      acc[stage] = companies.filter((c) => c.pipelineStage === stage).length;
      return acc;
    },
    {} as Record<string, number>,
  );

  const sectorMap: Record<string, number> = {};
  companies.forEach((c) => {
    const sector = c.sector || "Uncategorized";
    sectorMap[sector] = (sectorMap[sector] || 0) + 1;
  });
  const sectorEntries = Object.entries(sectorMap).sort((a, b) => b[1] - a[1]);

  const investedCount = stageCounts["invested"] || 0;
  const passedCount = stageCounts["passed"] || 0;
  const decidedCount = investedCount + passedCount;
  const investmentRate = decidedCount > 0 ? ((investedCount / decidedCount) * 100).toFixed(1) : "—";

  const activeDeals = total - investedCount - passedCount;

  const stageModelMap: Record<string, number> = {};
  companies.forEach((c) => {
    const model = c.businessModel || "Unknown";
    stageModelMap[model] = (stageModelMap[model] || 0) + 1;
  });
  const modelEntries = Object.entries(stageModelMap).sort((a, b) => b[1] - a[1]);

  return (
    <div className="p-6 max-w-4xl mx-auto h-full overflow-y-auto">
      <div className="mb-8">
        <h2 className="text-lg font-semibold tracking-tight" data-testid="text-page-title">Data</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Pipeline analytics and deal metrics
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mb-10">
        <StatTile
          label="Total Sourced"
          value={total}
          icon={Building2}
          detail={`${activeDeals} active`}
          testId="stat-total-sourced"
        />
        <StatTile
          label="Invested"
          value={investedCount}
          icon={CheckCircle2}
          detail={`of ${total} sourced`}
          testId="stat-invested"
        />
        <StatTile
          label="Investment Rate"
          value={investmentRate === "—" ? "—" : `${investmentRate}%`}
          icon={TrendingUp}
          detail={decidedCount > 0 ? `${investedCount} of ${decidedCount} decided` : "No decisions yet"}
          testId="stat-investment-rate"
        />
        <StatTile
          label="Sectors"
          value={sectorEntries.length}
          icon={Layers}
          detail={sectorEntries.length > 0 ? `Top: ${sectorEntries[0][0]}` : "None yet"}
          testId="stat-sectors"
        />
      </div>

      <div className="mb-10">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3 flex items-center gap-2">
          <Target className="w-3.5 h-3.5" />
          Deals by Pipeline Stage
        </h3>
        <div>
          {PIPELINE_STAGES.map((stage) => (
            <HorizontalBar
              key={stage}
              label={STAGE_LABELS[stage]}
              count={stageCounts[stage]}
              total={total}
              color={STAGE_COLORS[stage]}
              testId={`bar-stage-${stage}`}
            />
          ))}
        </div>
      </div>

      <div className="border-t pt-8 mb-10">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3 flex items-center gap-2">
          <BarChart3 className="w-3.5 h-3.5" />
          Deals by Sector
        </h3>
        {sectorEntries.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 text-center py-4">No sector data yet</p>
        ) : (
          <div>
            {sectorEntries.map(([sector, count], i) => (
              <HorizontalBar
                key={sector}
                label={sector}
                count={count}
                total={total}
                color={SECTOR_COLORS[i % SECTOR_COLORS.length]}
                testId={`bar-sector-${sector.replace(/[\s\/]/g, "-").toLowerCase()}`}
              />
            ))}
          </div>
        )}
      </div>

      <div className="border-t pt-8 mb-10">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3 flex items-center gap-2">
          <Layers className="w-3.5 h-3.5" />
          Deals by Business Model
        </h3>
        {modelEntries.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 text-center py-4">No model data yet</p>
        ) : (
          <div>
            {modelEntries.map(([model, count], i) => (
              <HorizontalBar
                key={model}
                label={model}
                count={count}
                total={total}
                color={SECTOR_COLORS[(i + 4) % SECTOR_COLORS.length]}
                testId={`bar-model-${model.replace(/[\s\/]/g, "-").toLowerCase()}`}
              />
            ))}
          </div>
        )}
      </div>

      <div className="border-t pt-8 mb-10">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3 flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5" />
          Funnel Summary
        </h3>
        <div className="space-y-2">
          {[
            { label: "Sourced", value: total, sub: "Total companies in pipeline" },
            { label: "Active", value: activeDeals, sub: "Currently being evaluated" },
            { label: "Decided", value: decidedCount, sub: `${investedCount} invested, ${passedCount} passed` },
            {
              label: "Conversion",
              value: investmentRate === "—" ? "—" : `${investmentRate}%`,
              sub: "Invested ÷ (Invested + Passed)",
            },
          ].map(({ label, value, sub }) => (
            <div key={label} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0" data-testid={`funnel-${label.toLowerCase()}`}>
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-[10px] text-muted-foreground">{sub}</p>
              </div>
              <span className="text-lg font-bold tabular-nums">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
