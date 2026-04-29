import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import {
  Loader2, Search, ArrowLeft, ChevronDown,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { runEnrichmentPipeline, type EnrichmentStage } from "@/lib/enrichment";
import { useAuth } from "@/hooks/use-auth";

const EXAMPLES = [
  "hyperliquid.xyz",
  "https://x.com/MorphoLabs",
  "ethena.fi",
  "AI infrastructure startup from YC W24",
  "https://github.com/paradigmxyz/reth",
];

function TypingPlaceholder() {
  const [idx, setIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [phase, setPhase] = useState<"typing" | "pause" | "clearing">("typing");
  const current = EXAMPLES[idx];

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (phase === "typing") {
      if (charIdx < current.length) {
        timer = setTimeout(() => setCharIdx((c) => c + 1), 40 + Math.random() * 25);
      } else {
        timer = setTimeout(() => setPhase("pause"), 2400);
      }
    } else if (phase === "pause") {
      timer = setTimeout(() => setPhase("clearing"), 100);
    } else {
      if (charIdx > 0) {
        timer = setTimeout(() => setCharIdx((c) => c - 1), 18);
      } else {
        setIdx((i) => (i + 1) % EXAMPLES.length);
        setPhase("typing");
      }
    }
    return () => clearTimeout(timer);
  }, [charIdx, phase, current.length]);

  return (
    <span className="text-muted-foreground/25 pointer-events-none select-none">
      {current.slice(0, charIdx)}
      <span className="inline-block w-[1.5px] h-[14px] bg-muted-foreground/30 animate-pulse ml-[1px] align-middle" />
    </span>
  );
}

const AGENT_LABELS: Record<string, string> = {
  scraper: "Web Scraper",
  identifier: "Identifier",
  token_identifier: "Token Scanner",
  contract_finder: "Contract Finder",
  contract_verifier: "Contract Verifier",
  researcher: "Research Agent",
  verify_clean: "Fact Checker",
  dd_reads: "DD Reads",
};

function AgentCard({ agentKey, stage }: { agentKey: string; stage: EnrichmentStage | undefined }) {
  const label = AGENT_LABELS[agentKey] || agentKey;
  const isActive = stage?.status === "running";
  const isDone = stage?.status === "complete";

  const getDetail = () => {
    if (!isDone || !stage) return null;
    if (stage.agent === "scraper") return stage.pagesFetched ? `${stage.pagesFetched} pages` : "no pages";
    if (stage.agent === "identifier" && stage.companyName) return stage.companyName;
    if (stage.agent === "token_identifier") return stage.hasLiquidToken ? `${stage.tokenTicker}` : "no token";
    if (stage.agent === "verify_clean") return stage.issuesFound === 0 ? "clean" : `${stage.issuesFound} fixed`;
    if (stage.agent === "dd_reads") return `${stage.readsFound || 0} reads`;
    return "done";
  };

  return (
    <div
      className={`relative rounded-lg border px-3 py-2.5 transition-all duration-500 ${
        isActive
          ? "border-border/30 bg-card/60 shadow-sm"
          : isDone
          ? "border-border/10 bg-card/20"
          : "border-border/[0.06] bg-transparent"
      }`}
      data-testid={`pipeline-stage-${agentKey}`}
    >
      {isActive && (
        <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-sky-500/[0.04] to-transparent pointer-events-none" />
      )}
      <div className="relative flex items-center gap-2.5">
        <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all duration-300 flex-shrink-0 ${
          isActive
            ? "border-sky-400/40 bg-sky-500/10"
            : isDone
            ? "border-emerald-500/30 bg-emerald-500/10"
            : "border-white/[0.06] bg-transparent"
        }`}>
          {isActive ? (
            <Loader2 className="w-2.5 h-2.5 animate-spin text-sky-400/70" />
          ) : isDone ? (
            <svg className="w-2.5 h-2.5 text-emerald-500/70" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2.5 6.5L5 9L9.5 3.5" />
            </svg>
          ) : (
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--color-block-separator)" }} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <span className={`text-[11px] font-medium transition-all duration-300 ${
            isActive ? "text-foreground/80" : isDone ? "text-foreground/40" : "text-foreground/15"
          }`}>
            {label}
          </span>
          {isActive && stage?.message && (
            <p className="text-[10px] text-muted-foreground/30 truncate mt-0.5">{stage.message}</p>
          )}
        </div>
        {isDone && getDetail() && (
          <span className={`text-[10px] font-medium ${
            stage?.agent === "token_identifier" && stage?.hasLiquidToken
              ? "text-amber-400/50"
              : "text-muted-foreground/25"
          }`}>
            {getDetail()}
          </span>
        )}
      </div>
    </div>
  );
}

export default function AddDeal() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { getAccessToken } = useAuth();
  const [enrichInput, setEnrichInput] = useState("");
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [pipelineStages, setPipelineStages] = useState<EnrichmentStage[]>([]);
  const [showManual, setShowManual] = useState(false);
  const [manualName, setManualName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputFocused, setInputFocused] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const seed = new URLSearchParams(window.location.search).get("seed");
      if (seed) {
        setEnrichInput(seed);
        window.history.replaceState({}, "", "/add");
      }
    }
    inputRef.current?.focus();
  }, []);

  const handleEnrichStream = async () => {
    if (!enrichInput.trim() || isEnriching) return;
    setIsEnriching(true);
    setEnrichError(null);
    setPipelineStages([]);

    try {
      const data = await runEnrichmentPipeline(
        enrichInput.trim(),
        (stage) => {
          setPipelineStages((prev) => {
            const existing = prev.findIndex((s) => s.agent === stage.agent);
            if (existing >= 0) {
              const updated = [...prev];
              updated[existing] = stage;
              return updated;
            }
            return [...prev, stage];
          });
        },
        getAccessToken,
      );

      const inputUrl = enrichInput.trim();
      const isUrl = inputUrl.startsWith("http://") || inputUrl.startsWith("https://");

      let websiteUrl = data.websiteUrl || "";
      if (!websiteUrl && isUrl) {
        try {
          const hostname = new URL(inputUrl).hostname.replace("www.", "").toLowerCase();
          const socialDomains = [
            "twitter.com", "x.com", "linkedin.com", "github.com",
            "facebook.com", "instagram.com", "tiktok.com", "youtube.com",
            "reddit.com", "medium.com", "substack.com",
            "producthunt.com", "crunchbase.com", "pitchbook.com",
          ];
          if (!socialDomains.some(d => hostname.includes(d))) {
            websiteUrl = inputUrl;
          }
        } catch {}
      }

      const enrichedData: Record<string, any> = {
        name: data.name || "",
        oneLiner: data.oneLiner || "",
        description: data.description || "",
        sector: data.sector || "",
        subSector: data.subSector || "",
        businessModel: data.businessModel || "",
        stage: data.stage || "",
        fundingHistory: data.fundingHistory || "",
        competitiveLandscape: data.competitiveLandscape || "",
        sourceUrl: isUrl ? inputUrl : "",
        websiteUrl,
        githubUrl: data.githubUrl || "",
        twitterUrl: data.twitterUrl || "",
        linkedinUrl: data.linkedinUrl || "",
        pipelineStage: "discovered",
        tags: data.tags || [],
      };

      if (data.adjacentReads && data.adjacentReads.length > 0) {
        enrichedData.adjacentReads = JSON.stringify(data.adjacentReads);
      }

      if (data.hasLiquidToken) {
        enrichedData.hasLiquidToken = true;
        enrichedData.tokenTier = data.tokenTier || "";
        enrichedData.tokenTicker = data.tokenTicker || "";
        enrichedData.tokenContractAddress = data.tokenContractAddress || "";
        enrichedData.tokenChain = data.tokenChain || "";
      }

      const enrichedFounders = (data.founders || []).map((f: any) => ({
        name: f.name || "",
        role: f.role || "",
        bio: f.bio || "",
        linkedinUrl: f.linkedinUrl || "",
        twitterUrl: f.twitterUrl || "",
        githubUrl: f.githubUrl || "",
        personalUrl: f.personalUrl || "",
        priorCompanies: f.priorCompanies || "",
      }));

      const res = await apiRequest("POST", "/api/companies", enrichedData);
      const company = await res.json();

      for (const founder of enrichedFounders) {
        if (founder.name.trim()) {
          await apiRequest("POST", `/api/companies/${company.id}/founders`, {
            ...founder,
            companyId: company.id,
          });
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: `"${company.name}" added successfully` });
      navigate(`/companies/${company.id}`);
    } catch (error: any) {
      setEnrichError(error.message);
      toast({ title: "Research failed", description: error.message, variant: "destructive" });
    } finally {
      setIsEnriching(false);
    }
  };

  const manualMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/companies", {
        name,
        oneLiner: "",
        description: "",
        pipelineStage: "discovered",
        tags: [],
      });
      return res.json();
    },
    onSuccess: (company) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: `"${company.name}" added` });
      navigate(`/companies/${company.id}`);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add deal", description: error.message, variant: "destructive" });
    },
  });

  const stageConfig = (() => {
    const tokenDetected = pipelineStages.some(s => s.agent === "token_identifier" && s.status === "complete" && s.hasLiquidToken);
    return [
      { key: "scraper" },
      { key: "identifier" },
      { key: "token_identifier" },
      ...(tokenDetected ? [
        { key: "contract_finder" },
        { key: "contract_verifier" },
      ] : []),
      { key: "researcher" },
      { key: "verify_clean" },
      { key: "dd_reads" },
    ];
  })();

  const completedCount = stageConfig.filter(({ key }) => {
    const s = pipelineStages.find(ps => ps.agent === key);
    return s?.status === "complete";
  }).length;

  const activeStage = stageConfig.find(({ key }) => {
    const s = pipelineStages.find(ps => ps.agent === key);
    return s?.status === "running";
  });
  const activeLabel = activeStage ? (AGENT_LABELS[activeStage.key] || activeStage.key) : null;

  const handleExampleClick = (example: string) => {
    setEnrichInput(example);
    inputRef.current?.focus();
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-2xl mx-auto">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground/40 hover:text-foreground/60 transition-colors mb-16"
          data-testid="button-back"
        >
          <ArrowLeft className="w-3 h-3" />
          Pipeline
        </button>

        <div className={`flex flex-col items-center transition-all duration-700 ${
          isEnriching || pipelineStages.length > 0 ? "mb-8" : "mb-12"
        }`}>
          {!isEnriching && pipelineStages.length === 0 && (
            <div className="mb-8 text-center">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground/90 mb-2" data-testid="text-page-title">
                Add Deal
              </h1>
              <p className="text-[13px] text-muted-foreground/40 max-w-md leading-relaxed">
                Drop a URL, company name, tweet, or founder profile.<br />
                AI agents will build the complete deal card.
              </p>
            </div>
          )}

          <div className={`w-full transition-all duration-500 ${
            isEnriching ? "max-w-xl" : "max-w-lg"
          }`}>
            <div className={`relative rounded-xl border transition-all duration-300 ${
              isEnriching
                ? "border-sky-500/20 bg-sky-500/[0.02] shadow-[0_0_30px_-10px_rgba(56,189,248,0.08)]"
                : inputFocused
                ? "border-border/30 bg-card/30 shadow-sm"
                : "border-border/15 bg-card/20 hover:border-border/25 hover:bg-card/25"
            }`}>
              <div className="flex items-center gap-3 px-4 py-3.5">
                <Search className={`w-4 h-4 flex-shrink-0 transition-colors duration-300 ${
                  isEnriching ? "text-sky-400/50" : inputFocused ? "text-foreground/30" : "text-muted-foreground/20"
                }`} />
                <div className="flex-1 relative">
                  <input
                    ref={inputRef}
                    value={enrichInput}
                    onChange={(e) => setEnrichInput(e.target.value)}
                    onFocus={() => setInputFocused(true)}
                    onBlur={() => setInputFocused(false)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleEnrichStream();
                      }
                    }}
                    disabled={isEnriching}
                    className="w-full bg-transparent text-sm text-foreground outline-none disabled:opacity-40"
                    data-testid="input-enrich"
                  />
                  {!enrichInput && !isEnriching && (
                    <div className="absolute inset-0 flex items-center">
                      <TypingPlaceholder />
                    </div>
                  )}
                </div>
                {isEnriching && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-sky-400/40 font-medium whitespace-nowrap">
                      {completedCount}/{stageConfig.length}
                    </span>
                  </div>
                )}
              </div>

              {enrichInput.trim() && !isEnriching && (
                <div className="border-t border-border/10 px-4 py-2 flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground/30">Press Enter to research</span>
                  <button
                    onClick={handleEnrichStream}
                    className="text-[11px] font-medium text-sky-400/60 hover:text-sky-400 transition-colors px-2 py-0.5 rounded hover:bg-sky-400/5"
                    data-testid="button-enrich"
                  >
                    Research
                  </button>
                </div>
              )}
            </div>

            {!isEnriching && pipelineStages.length === 0 && !enrichInput && (
              <div className="flex items-center justify-center gap-2 mt-4 flex-wrap">
                {EXAMPLES.slice(0, 3).map((ex) => (
                  <button
                    key={ex}
                    onClick={() => handleExampleClick(ex)}
                    className="text-[10px] px-2.5 py-1 rounded-md border border-border/10 text-muted-foreground/30 hover:text-muted-foreground/60 hover:border-border/20 hover:bg-card/30 transition-all"
                    data-testid={`example-${ex.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {isEnriching && (
          <div className="mb-8 animate-in fade-in slide-in-from-bottom-2 duration-500" data-testid="pipeline-progress">
            <div className="flex items-center gap-3 mb-5">
              <div className="flex gap-[3px] flex-1">
                {stageConfig.map(({ key }) => {
                  const stage = pipelineStages.find(ps => ps.agent === key);
                  const isDone = stage?.status === "complete";
                  const isActive = stage?.status === "running";
                  return (
                    <div
                      key={key}
                      className={`h-[3px] flex-1 rounded-full transition-all duration-700 ${
                        isDone
                          ? "bg-emerald-500/30"
                          : isActive
                          ? "bg-sky-400/30"
                          : "bg-foreground/[0.05]"
                      }`}
                    >
                      {isActive && (
                        <div className="h-full rounded-full bg-sky-400/50 animate-pulse" style={{ width: "60%" }} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {activeLabel && (
              <div className="flex items-center gap-2.5 mb-5 px-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400/60" />
                <span className="text-[12px] text-foreground/60 font-medium">{activeLabel}</span>
                {activeStage && (() => {
                  const s = pipelineStages.find(ps => ps.agent === activeStage.key);
                  return s?.message ? <span className="text-[11px] text-muted-foreground/20">{s.message}</span> : null;
                })()}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              {stageConfig.map(({ key }) => {
                const stage = pipelineStages.find((s) => s.agent === key);
                return <AgentCard key={key} agentKey={key} stage={stage} />;
              })}
            </div>
          </div>
        )}

        {enrichError && (
          <div className="mb-6 rounded-xl border border-red-500/10 bg-red-500/[0.03] px-4 py-3 animate-in fade-in duration-300">
            <p className="text-[12px] text-red-400/70">{enrichError}</p>
            <button
              onClick={() => { setEnrichError(null); setIsEnriching(false); }}
              className="text-[11px] text-red-400/40 hover:text-red-400/60 mt-1 transition-colors"
              data-testid="button-dismiss-error"
            >
              Try again
            </button>
          </div>
        )}

        {!isEnriching && pipelineStages.length === 0 && (
          <div className="border-t border-border/[0.06] pt-8 mt-8">
            <button
              onClick={() => setShowManual(!showManual)}
              className="flex items-center gap-2 text-[11px] text-muted-foreground/20 hover:text-muted-foreground/40 transition-colors w-full justify-center group"
              data-testid="button-toggle-manual"
            >
              <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${showManual ? "rotate-180" : ""}`} />
              <span>or add manually</span>
            </button>

            {showManual && (
              <div className="mt-5 max-w-sm mx-auto animate-in fade-in slide-in-from-top-1 duration-200">
                <div className="flex items-center gap-2">
                  <div className="flex-1 rounded-lg border border-border/15 bg-card/20 overflow-hidden focus-within:border-border/30 transition-colors">
                    <input
                      value={manualName}
                      onChange={(e) => setManualName(e.target.value)}
                      placeholder="Company name"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && manualName.trim()) {
                          e.preventDefault();
                          manualMutation.mutate(manualName.trim());
                        }
                      }}
                      className="w-full bg-transparent px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/30"
                      data-testid="input-manual-name"
                    />
                  </div>
                  <button
                    onClick={() => manualName.trim() && manualMutation.mutate(manualName.trim())}
                    disabled={!manualName.trim() || manualMutation.isPending}
                    className="h-[38px] px-4 text-[12px] font-medium rounded-lg border border-border/15 text-foreground/50 hover:text-foreground/70 hover:border-border/25 hover:bg-card/30 transition-all disabled:opacity-15 disabled:cursor-not-allowed"
                    data-testid="button-manual-add"
                  >
                    {manualMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Add"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
