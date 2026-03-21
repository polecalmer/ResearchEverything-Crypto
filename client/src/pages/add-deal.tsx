import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PIPELINE_STAGES, STAGE_LABELS } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Briefcase,
  DollarSign,
  Tag,
  Plus,
  Trash2,
  User,
  Loader2,
  Check,
} from "lucide-react";
import { useState } from "react";
import { runEnrichmentPipeline, type EnrichmentStage } from "@/lib/enrichment";
import { useAuth } from "@/hooks/use-auth";

const SECTORS = [
  "AI / ML", "AI Infra", "Fintech", "DevTools", "Consumer", "Healthcare",
  "Climate", "Crypto / Web3", "Enterprise SaaS", "Marketplace",
  "Cybersecurity", "Biotech", "Edtech", "Other",
];

const BUSINESS_MODELS = [
  "SaaS", "Marketplace", "Infrastructure", "Consumer", "API / Platform",
  "Hardware", "Services", "Open Source", "Other",
];

const STAGES = ["Pre-seed", "Seed", "Series A", "Series B", "Growth", "Public"];

const addDealSchema = z.object({
  name: z.string().min(1, "Company name is required"),
  oneLiner: z.string().min(1, "One-liner is required"),
  description: z.string().optional().default(""),
  sector: z.string().optional().default(""),
  subSector: z.string().optional().default(""),
  businessModel: z.string().optional().default(""),
  stage: z.string().optional().default(""),
  fundingHistory: z.string().optional().default(""),
  competitiveLandscape: z.string().optional().default(""),
  sourceUrl: z.string().optional().default(""),
  websiteUrl: z.string().optional().default(""),
  githubUrl: z.string().optional().default(""),
  twitterUrl: z.string().optional().default(""),
  linkedinUrl: z.string().optional().default(""),
  pipelineStage: z.string().default("discovered"),
  tags: z.array(z.string()).default([]),
});

type AddDealForm = z.infer<typeof addDealSchema>;

interface FounderForm {
  name: string;
  role: string;
  bio: string;
  linkedinUrl: string;
  twitterUrl: string;
  githubUrl: string;
  personalUrl: string;
  priorCompanies: string;
}

export default function AddDeal() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { getAccessToken } = useAuth();
  const [founders, setFounders] = useState<FounderForm[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [enrichInput, setEnrichInput] = useState("");
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [pipelineStages, setPipelineStages] = useState<EnrichmentStage[]>([]);

  const form = useForm<AddDealForm>({
    resolver: zodResolver(addDealSchema),
    defaultValues: {
      name: "",
      oneLiner: "",
      description: "",
      sector: "",
      businessModel: "",
      stage: "",
      fundingHistory: "",
      competitiveLandscape: "",
      sourceUrl: "",
      websiteUrl: "",
      githubUrl: "",
      twitterUrl: "",
      linkedinUrl: "",
      pipelineStage: "discovered",
      tags: [],
    },
  });

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

      const enrichedData: AddDealForm & { adjacentReads?: string; hasLiquidToken?: boolean; tokenTier?: string; tokenTicker?: string; tokenContractAddress?: string; tokenChain?: string; liquidTokenAnalysis?: string } = {
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

      const enrichedFounders: FounderForm[] = (data.founders || []).map((f: any) => ({
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
      toast({ title: "AI research failed", description: error.message, variant: "destructive" });
    } finally {
      setIsEnriching(false);
    }
  };

  const createMutation = useMutation({
    mutationFn: async (data: AddDealForm) => {
      const res = await apiRequest("POST", "/api/companies", data);
      const company = await res.json();

      for (const founder of founders) {
        if (founder.name.trim()) {
          await apiRequest("POST", `/api/companies/${company.id}/founders`, {
            ...founder,
            companyId: company.id,
          });
        }
      }

      return company;
    },
    onSuccess: (company) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Deal added successfully" });
      navigate(`/companies/${company.id}`);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add deal", description: error.message, variant: "destructive" });
    },
  });

  const addFounder = () => {
    setFounders([...founders, { name: "", role: "", bio: "", linkedinUrl: "", twitterUrl: "", githubUrl: "", personalUrl: "", priorCompanies: "" }]);
  };

  const removeFounder = (index: number) => {
    setFounders(founders.filter((_, i) => i !== index));
  };

  const updateFounder = (index: number, field: keyof FounderForm, value: string) => {
    const updated = [...founders];
    updated[index] = { ...updated[index], [field]: value };
    setFounders(updated);
  };

  const addTag = () => {
    const tag = tagInput.trim();
    if (!tag) return;
    const current = form.getValues("tags");
    if (!current.includes(tag)) {
      form.setValue("tags", [...current, tag]);
    }
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    const current = form.getValues("tags");
    form.setValue("tags", current.filter((t) => t !== tag));
  };

  const onSubmit = (data: AddDealForm) => {
    createMutation.mutate(data);
  };

  return (
    <div className="p-6 max-w-3xl mx-auto h-full overflow-y-auto">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50 mb-6">
        <button onClick={() => navigate("/")} className="hover:text-foreground transition-colors" data-testid="button-back">Pipeline</button>
        <span className="text-muted-foreground/20">/</span>
        <span className="text-foreground/70">New Deal</span>
      </div>

        <div className="mb-8 pb-8 border-b border-border/20">
          <div className="mb-4">
            <h2 className="text-sm font-medium text-foreground/80 mb-1">AI Research</h2>
            <p className="text-[11px] text-muted-foreground/40">Paste a URL or company name to auto-research</p>
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-2 border border-border/20 rounded px-3 py-2 focus-within:border-border/40 transition-colors">
              <input
                value={enrichInput}
                onChange={(e) => setEnrichInput(e.target.value)}
                placeholder="URL, company name, tweet, founder profile..."
                onKeyDown={(e) => e.key === "Enter" && handleEnrichStream()}
                disabled={isEnriching}
                className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/25 disabled:opacity-30"
                data-testid="input-enrich"
              />
            </div>
            <p className="text-[10px] text-muted-foreground/30">
              Websites, tweets, X/LinkedIn profiles, blog posts, Product Hunt, GitHub repos, company names
            </p>

            {pipelineStages.length > 0 && (
              <div className="py-3" data-testid="pipeline-progress">
                {(() => {
                  const tokenDetected = pipelineStages.some(s => s.agent === "token_identifier" && s.status === "complete" && s.hasLiquidToken);
                  const baseStages = [
                    { key: "scraper", label: "web_scraper" },
                    { key: "identifier", label: "identifier" },
                    { key: "token_identifier", label: "token_identifier" },
                    ...(tokenDetected ? [
                      { key: "contract_finder", label: "contract_finder" },
                      { key: "contract_verifier", label: "contract_verifier" },
                    ] : []),
                    { key: "researcher", label: "research_agent" },
                    { key: "verify_clean", label: "verify_clean" },
                    { key: "dd_reads", label: "dd_reads" },
                  ];
                  return baseStages;
                })().map(({ key, label }, idx) => {
                  const stage = pipelineStages.find((s) => s.agent === key);
                  const isActive = stage?.status === "running";
                  const isDone = stage?.status === "complete";
                  const isPending = !stage;

                  const getStatusLine = () => {
                    if (isDone && stage?.agent === "scraper") return stage.pagesFetched ? `fetched ${stage.pagesFetched} page(s)` : "no urls to fetch";
                    if (isDone && stage?.agent === "identifier" && stage.companyName) return `identified: ${stage.companyName} (${stage.confidence})`;
                    if (isDone && stage?.agent === "token_identifier") return stage.hasLiquidToken ? `${stage.tokenTicker} detected (${stage.tokenTier})` : "no liquid token";
                    if (isDone && stage?.agent === "verify_clean") return stage.issuesFound === 0 ? "all claims verified" : `${stage.issuesFound} issue(s) cleaned`;
                    if (isDone && stage?.agent === "dd_reads") return `${stage.readsFound || 0} reads found`;
                    if (isDone) return "done";
                    return null;
                  };

                  return (
                    <div
                      key={key}
                      className={`flex items-center gap-3 py-1.5 transition-opacity duration-300 ${isPending ? "opacity-[0.15]" : isDone ? "opacity-40" : "opacity-90"}`}
                      data-testid={`pipeline-stage-${key}`}
                    >
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${isDone ? "bg-emerald-500/15" : isActive ? "bg-white/[0.06]" : "bg-white/[0.03]"}`}>
                        {isDone ? (
                          <Check className="w-2.5 h-2.5 text-emerald-400" />
                        ) : isActive ? (
                          <Loader2 className="w-2.5 h-2.5 animate-spin text-white/50" />
                        ) : (
                          <div className="w-1 h-1 rounded-full bg-white/20" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className={`text-[12px] tracking-tight ${isActive ? "text-white/80 font-medium" : "text-white/50"}`}>
                          {label}
                        </span>
                        {isActive && stage?.message && (
                          <span className="text-[11px] text-white/25 ml-2">{stage.message}</span>
                        )}
                        {isDone && getStatusLine() && (
                          <span className="text-[11px] text-white/20 ml-2">{getStatusLine()}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {enrichError && (
              <p className="text-[11px] text-red-400/70">{enrichError}</p>
            )}

            <button
              type="button"
              onClick={handleEnrichStream}
              disabled={!enrichInput.trim() || isEnriching}
              className="w-full py-2.5 text-[12px] tracking-tight rounded-lg border border-white/[0.06] text-white/50 hover:text-white/80 hover:border-white/[0.12] hover:bg-white/[0.03] transition-all disabled:opacity-15 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              data-testid="button-enrich"
            >
              {isEnriching ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Running research pipeline...
                </>
              ) : (
                "Auto-research"
              )}
            </button>
          </div>
        </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/40">Manual Entry</span>
              <span className="flex-1 border-t border-border/15" />
            </div>
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Company Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Acme Inc" {...field} data-testid="input-company-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="oneLiner"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>One-Liner *</FormLabel>
                    <FormControl>
                      <Input placeholder="What they do in one sentence" {...field} data-testid="input-one-liner" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Longer product/market description"
                        className="min-h-[80px] resize-none"
                        {...field}
                        data-testid="textarea-description"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="sourceUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Source URL</FormLabel>
                    <FormControl>
                      <Input placeholder="https://..." {...field} data-testid="input-source-url" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="websiteUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Website</FormLabel>
                      <FormControl>
                        <Input placeholder="https://company.com" {...field} data-testid="input-website-url" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="linkedinUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>LinkedIn</FormLabel>
                      <FormControl>
                        <Input placeholder="https://linkedin.com/company/..." {...field} data-testid="input-linkedin-url" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="githubUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>GitHub</FormLabel>
                      <FormControl>
                        <Input placeholder="https://github.com/..." {...field} data-testid="input-github-url" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="twitterUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Twitter / X</FormLabel>
                      <FormControl>
                        <Input placeholder="https://x.com/..." {...field} data-testid="input-twitter-url" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
          </div>

          <div className="border-t pt-8">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-4 flex items-center gap-2">
              <Briefcase className="w-3.5 h-3.5" />
              Classification
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="sector"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sector</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-sector">
                          <SelectValue placeholder="Select sector" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {SECTORS.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="businessModel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business Model</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-business-model">
                          <SelectValue placeholder="Select model" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {BUSINESS_MODELS.map((m) => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="stage"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Company Stage</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-stage">
                          <SelectValue placeholder="Select stage" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {STAGES.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="pipelineStage"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pipeline Stage</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-pipeline-stage">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PIPELINE_STAGES.map((stage) => (
                          <SelectItem key={stage} value={stage}>{STAGE_LABELS[stage]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          <div className="border-t pt-8">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-4 flex items-center gap-2">
              <DollarSign className="w-3.5 h-3.5" />
              Market Context
            </h3>
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="fundingHistory"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Funding History</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Known rounds, investors, amounts"
                        className="min-h-[60px] resize-none"
                        {...field}
                        data-testid="textarea-funding"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="competitiveLandscape"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Competitive Landscape</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="3-5 comparable or competing companies"
                        className="min-h-[60px] resize-none"
                        {...field}
                        data-testid="textarea-competitive"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          <div className="border-t pt-8">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-4 flex items-center gap-2">
              <Tag className="w-3.5 h-3.5" />
              Tags
            </h3>
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              {form.watch("tags").map((tag) => (
                <Badge key={tag} variant="secondary" className="cursor-pointer" onClick={() => removeTag(tag)}>
                  {tag} <span className="ml-1 text-muted-foreground">&times;</span>
                </Badge>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder='e.g. "AI Agents", "Crypto Infra"'
                className="h-8 text-sm"
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
                data-testid="input-tag"
              />
              <Button type="button" size="sm" variant="secondary" onClick={addTag} data-testid="button-add-tag">
                Add
              </Button>
            </div>
          </div>

          <div className="border-t pt-8">
            <div className="flex items-center justify-between gap-2 mb-4">
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-2">
                <User className="w-3.5 h-3.5" />
                Founders
              </h3>
              <Button type="button" size="sm" variant="secondary" onClick={addFounder} data-testid="button-add-founder">
                <Plus className="w-3 h-3 mr-1" />
                Add Founder
              </Button>
            </div>
            {founders.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                No founders added yet
              </p>
            ) : (
              <div className="space-y-4">
                {founders.map((founder, index) => (
                  <div key={index} className="rounded-lg bg-accent/30 p-4 space-y-3" data-testid={`founder-form-${index}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground">Founder {index + 1}</span>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => removeFounder(index)}
                        data-testid={`button-remove-founder-${index}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        value={founder.name}
                        onChange={(e) => updateFounder(index, "name", e.target.value)}
                        placeholder="Name"
                        className="h-8 text-sm"
                        data-testid={`input-founder-name-${index}`}
                      />
                      <Input
                        value={founder.role}
                        onChange={(e) => updateFounder(index, "role", e.target.value)}
                        placeholder="Role (e.g. CEO, CTO)"
                        className="h-8 text-sm"
                        data-testid={`input-founder-role-${index}`}
                      />
                      <Input
                        value={founder.linkedinUrl}
                        onChange={(e) => updateFounder(index, "linkedinUrl", e.target.value)}
                        placeholder="LinkedIn URL"
                        className="h-8 text-sm"
                        data-testid={`input-founder-linkedin-${index}`}
                      />
                      <Input
                        value={founder.twitterUrl}
                        onChange={(e) => updateFounder(index, "twitterUrl", e.target.value)}
                        placeholder="Twitter/X URL"
                        className="h-8 text-sm"
                        data-testid={`input-founder-twitter-${index}`}
                      />
                      <Input
                        value={founder.githubUrl}
                        onChange={(e) => updateFounder(index, "githubUrl", e.target.value)}
                        placeholder="GitHub URL"
                        className="h-8 text-sm"
                        data-testid={`input-founder-github-${index}`}
                      />
                      <Input
                        value={founder.personalUrl}
                        onChange={(e) => updateFounder(index, "personalUrl", e.target.value)}
                        placeholder="Personal website URL"
                        className="h-8 text-sm"
                        data-testid={`input-founder-website-${index}`}
                      />
                    </div>
                    <Input
                      value={founder.bio}
                      onChange={(e) => updateFounder(index, "bio", e.target.value)}
                      placeholder="Short bio"
                      className="h-8 text-sm"
                      data-testid={`input-founder-bio-${index}`}
                    />
                    <Input
                      value={founder.priorCompanies}
                      onChange={(e) => updateFounder(index, "priorCompanies", e.target.value)}
                      placeholder="Prior companies (comma separated)"
                      className="h-8 text-sm"
                      data-testid={`input-founder-prior-${index}`}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pb-8 border-t pt-8">
            <Button type="button" variant="secondary" onClick={() => navigate("/")} data-testid="button-cancel">
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-deal">
              {createMutation.isPending ? "Adding..." : "Add Deal"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
