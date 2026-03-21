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
  Building2,
  Briefcase,
  DollarSign,
  Tag,
  ArrowLeft,
  Plus,
  Trash2,
  User,
  Sparkles,
  Loader2,
  CheckCircle2,
  Search,
  FileSearch,
  ShieldCheck,
  Globe,
  FileText,
  Coins,
  BarChart3,
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
        if (data.liquidTokenAnalysis) {
          enrichedData.liquidTokenAnalysis = typeof data.liquidTokenAnalysis === "string"
            ? data.liquidTokenAnalysis
            : JSON.stringify(data.liquidTokenAnalysis);
        }
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
      <button
        onClick={() => navigate("/")}
        className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4"
        data-testid="button-back"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Pipeline
      </button>

      <div className="mb-8">
        <h2 className="text-lg font-semibold tracking-tight" data-testid="text-page-title">Add New Deal</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Drop any link or text above to auto-add with AI, or fill in the form manually below.
        </p>
      </div>

        <div className="mb-8 pb-8 border-b">
          <h3 className="text-xs uppercase tracking-wider text-foreground font-medium mb-3 flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5" />
            AI Auto-Research
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            Drop any link or text and a team of 5 AI agents will identify, detect tokens, research, verify, and find critical due diligence reads.
          </p>
          <div className="space-y-3">
            <Input
              value={enrichInput}
              onChange={(e) => setEnrichInput(e.target.value)}
              placeholder="Paste a URL, company name, tweet link, founder profile..."
              onKeyDown={(e) => e.key === "Enter" && handleEnrichStream()}
              disabled={isEnriching}
              data-testid="input-enrich"
            />
            <p className="text-[11px] text-muted-foreground">
              Works with: company websites, tweets, X/LinkedIn profiles, blog posts, Product Hunt, GitHub repos, or plain company names
            </p>

            {pipelineStages.length > 0 && (
              <div className="space-y-1.5 py-3" data-testid="pipeline-progress">
                <p className="text-xs font-medium text-muted-foreground mb-2">Agent Pipeline</p>
                {(() => {
                  const hasLiquidToken = pipelineStages.some(
                    (s) => s.agent === "token_identifier" && s.status === "complete" && s.hasLiquidToken
                  );
                  const stages = [
                    { key: "scraper", icon: Globe, label: "Web Scraper" },
                    { key: "identifier", icon: Search, label: "Identifier Agent" },
                    { key: "token_identifier", icon: Coins, label: "Token Identifier" },
                    { key: "researcher", icon: FileSearch, label: "Research Agent" },
                    { key: "verify_clean", icon: ShieldCheck, label: "Verify & Clean Agent" },
                    { key: "dd_reads", icon: FileText, label: "Due Diligence Reads" },
                    ...(hasLiquidToken ? [{ key: "liquid_token_research", icon: BarChart3, label: "Liquid Token Research" }] : []),
                  ];
                  return stages;
                })().map(({ key, icon: Icon, label }, idx, stages) => {
                  const stage = pipelineStages.find((s) => s.agent === key);
                  const isActive = stage?.status === "running";
                  const isDone = stage?.status === "complete";
                  const isPending = !stage;

                  return (
                    <div
                      key={key}
                      className={`flex items-center gap-3 py-2 px-3 rounded-md transition-colors ${
                        isActive ? "bg-accent/50" : ""
                      }`}
                      data-testid={`pipeline-stage-${key}`}
                    >
                      <div className="w-5 h-5 flex items-center justify-center">
                        {isActive && <Loader2 className="w-4 h-4 animate-spin text-foreground" />}
                        {isDone && <CheckCircle2 className="w-4 h-4 text-green-600" />}
                        {isPending && <Icon className="w-4 h-4 text-muted-foreground/30" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-medium ${isPending ? "text-muted-foreground/30" : ""}`}>
                          {label}
                        </p>
                        {isActive && stage?.message && (
                          <p className="text-[11px] text-muted-foreground">{stage.message}</p>
                        )}
                        {isDone && stage?.agent === "scraper" && (
                          <p className="text-[11px] text-green-600/70">
                            {stage.pagesFetched
                              ? `Fetched ${stage.pagesFetched} page${stage.pagesFetched === 1 ? "" : "s"}`
                              : "No URLs to fetch"}
                          </p>
                        )}
                        {isDone && stage?.agent === "identifier" && stage.companyName && (
                          <p className="text-[11px] text-green-600/70">
                            Identified: {stage.companyName} ({stage.confidence} confidence)
                          </p>
                        )}
                        {isDone && stage?.agent === "token_identifier" && (
                          <p className="text-[11px] text-green-600/70">
                            {stage.hasLiquidToken
                              ? `Liquid token detected: ${stage.tokenTicker} (${stage.tokenTier})`
                              : "No liquid token detected"}
                          </p>
                        )}
                        {isDone && stage?.agent === "verify_clean" && (
                          <p className="text-[11px] text-green-600/70">
                            {stage.issuesFound === 0
                              ? "All claims verified — output clean"
                              : `${stage.issuesFound} issue${stage.issuesFound === 1 ? "" : "s"} found and cleaned`}
                          </p>
                        )}
                        {isDone && stage?.agent === "dd_reads" && (
                          <p className="text-[11px] text-green-600/70">
                            {stage.readsFound || 0} adjacent reads found
                          </p>
                        )}
                        {isDone && stage?.agent === "liquid_token_research" && (
                          <p className="text-[11px] text-green-600/70">
                            Token analysis complete
                          </p>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground/40 tabular-nums">{idx + 1}/{stages.length}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {enrichError && (
              <div className="text-sm text-destructive">
                <p>{enrichError}</p>
              </div>
            )}

            <Button
              type="button"
              onClick={handleEnrichStream}
              disabled={!enrichInput.trim() || isEnriching}
              className="w-full"
              data-testid="button-enrich"
            >
              {isEnriching ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  Researching...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-1.5" />
                  Add &amp; Research with AI
                </>
              )}
            </Button>
          </div>
        </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <div>
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-4 flex items-center gap-2">
              <Building2 className="w-3.5 h-3.5" />
              Company Info
            </h3>
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
