import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Loader2, Search, ArrowLeft, ChevronDown, ChevronUp } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { runEnrichmentPipeline, type EnrichmentStage } from "@/lib/enrichment";
import { useAuth } from "@/hooks/use-auth";

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
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
      { key: "scraper", label: "Scraping" },
      { key: "identifier", label: "Identifying" },
      { key: "token_identifier", label: "Token Detection" },
      ...(tokenDetected ? [
        { key: "contract_finder", label: "Finding Contracts" },
        { key: "contract_verifier", label: "Verifying Contracts" },
      ] : []),
      { key: "researcher", label: "Researching" },
      { key: "verify_clean", label: "Fact-Checking" },
      { key: "dd_reads", label: "Finding DD Reads" },
    ];
  })();

  const activeStage = stageConfig.find(({ key }) => {
    const s = pipelineStages.find(ps => ps.agent === key);
    return s?.status === "running";
  });

  const completedCount = stageConfig.filter(({ key }) => {
    const s = pipelineStages.find(ps => ps.agent === key);
    return s?.status === "complete";
  }).length;

  return (
    <div ref={containerRef} className="h-full overflow-y-auto">
      <div className="p-6 max-w-2xl mx-auto">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50 hover:text-foreground/70 transition-colors mb-10"
          data-testid="button-back"
        >
          <ArrowLeft className="w-3 h-3" />
          Pipeline
        </button>

        <div className="flex flex-col items-center text-center mb-8">
          <h1 className="text-lg font-medium text-foreground/90 mb-1.5" data-testid="text-page-title">Add Deal</h1>
          <p className="text-[12px] text-muted-foreground/40 max-w-sm">
            Paste a URL, company name, tweet, or founder profile. The AI agents will research and build the deal card automatically.
          </p>
        </div>

        <div className="relative mb-4">
          <div className={`flex items-center gap-3 border rounded-lg px-4 py-3 transition-all ${
            isEnriching
              ? "border-sky-500/30 bg-sky-500/[0.03]"
              : "border-border/20 focus-within:border-border/40 hover:border-border/30"
          }`}>
            <Search className={`w-4 h-4 flex-shrink-0 ${isEnriching ? "text-sky-400/50" : "text-muted-foreground/30"}`} />
            <input
              ref={inputRef}
              value={enrichInput}
              onChange={(e) => setEnrichInput(e.target.value)}
              placeholder="morpho.org, Morpho, twitter.com/MorphoLabs..."
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleEnrichStream();
                }
              }}
              disabled={isEnriching}
              className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/40 disabled:opacity-40"
              data-testid="input-enrich"
            />
            {enrichInput.trim() && !isEnriching && (
              <button
                onClick={handleEnrichStream}
                className="text-[11px] font-medium text-sky-400/70 hover:text-sky-400 transition-colors whitespace-nowrap"
                data-testid="button-enrich"
              >
                Research
              </button>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground/30 mt-2 text-center">
            URLs, tweets, X/LinkedIn profiles, blog posts, Product Hunt, GitHub repos, company names
          </p>
        </div>

        {isEnriching && (
          <div className="mt-6 rounded-lg border border-border/10 bg-card/30 px-5 py-4" data-testid="pipeline-progress">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400/60" />
                <span className="text-[12px] text-foreground/70 font-medium">
                  {activeStage?.label || "Starting..."}
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground/30">
                {completedCount}/{stageConfig.length}
              </span>
            </div>

            <div className="flex gap-1 mb-4">
              {stageConfig.map(({ key }) => {
                const stage = pipelineStages.find(ps => ps.agent === key);
                const isDone = stage?.status === "complete";
                const isActive = stage?.status === "running";
                return (
                  <div
                    key={key}
                    className={`h-1 flex-1 rounded-full transition-all duration-500 ${
                      isDone ? "bg-emerald-500/40" : isActive ? "bg-sky-400/40 animate-pulse" : "bg-white/[0.04]"
                    }`}
                  />
                );
              })}
            </div>

            <div className="space-y-0.5">
              {stageConfig.map(({ key, label }) => {
                const stage = pipelineStages.find((s) => s.agent === key);
                const isActive = stage?.status === "running";
                const isDone = stage?.status === "complete";
                const isPending = !stage;

                const getDetail = () => {
                  if (isDone && stage?.agent === "scraper") return stage.pagesFetched ? `${stage.pagesFetched} page(s) fetched` : "no pages";
                  if (isDone && stage?.agent === "identifier" && stage.companyName) return `${stage.companyName} (${stage.confidence})`;
                  if (isDone && stage?.agent === "token_identifier") return stage.hasLiquidToken ? `${stage.tokenTicker} (${stage.tokenTier})` : "no token";
                  if (isDone && stage?.agent === "verify_clean") return stage.issuesFound === 0 ? "verified" : `${stage.issuesFound} cleaned`;
                  if (isDone && stage?.agent === "dd_reads") return `${stage.readsFound || 0} reads`;
                  if (isDone) return "done";
                  if (isActive && stage?.message) return stage.message;
                  return null;
                };

                return (
                  <div
                    key={key}
                    className={`flex items-center gap-2.5 py-1 transition-all duration-300 ${
                      isPending ? "opacity-[0.1]" : isDone ? "opacity-30" : "opacity-90"
                    }`}
                    data-testid={`pipeline-stage-${key}`}
                  >
                    <span className="w-3.5 flex-shrink-0 flex items-center justify-center text-[10px]">
                      {isDone ? (
                        <span className="text-emerald-500/70">&#10003;</span>
                      ) : isActive ? (
                        <span className="text-sky-400/60">&#9679;</span>
                      ) : (
                        <span className="text-white/15">&#9675;</span>
                      )}
                    </span>
                    <span className={`text-[11px] ${isActive ? "text-foreground/70" : "text-foreground/40"}`}>
                      {label}
                    </span>
                    {getDetail() && (
                      <span className="text-[10px] text-muted-foreground/25 ml-auto">{getDetail()}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {enrichError && (
          <div className="mt-4 rounded-lg border border-red-500/10 bg-red-500/[0.03] px-4 py-3">
            <p className="text-[11px] text-red-400/70">{enrichError}</p>
          </div>
        )}

        {!isEnriching && pipelineStages.length === 0 && (
          <div className="mt-10 border-t border-border/10 pt-6">
            <button
              onClick={() => setShowManual(!showManual)}
              className="flex items-center gap-2 text-[11px] text-muted-foreground/30 hover:text-muted-foreground/50 transition-colors w-full justify-center"
              data-testid="button-toggle-manual"
            >
              {showManual ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              Add manually without AI
            </button>

            {showManual && (
              <div className="mt-4 flex items-center gap-2">
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
                  className="flex-1 bg-transparent border border-border/20 rounded-lg px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-border/40"
                  data-testid="input-manual-name"
                />
                <button
                  onClick={() => manualName.trim() && manualMutation.mutate(manualName.trim())}
                  disabled={!manualName.trim() || manualMutation.isPending}
                  className="px-4 py-2 text-[12px] rounded-lg border border-border/20 text-foreground/60 hover:text-foreground/80 hover:border-border/30 transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                  data-testid="button-manual-add"
                >
                  {manualMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Add"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
