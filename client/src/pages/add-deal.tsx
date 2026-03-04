import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { insertCompanySchema, PIPELINE_STAGES, STAGE_LABELS, type PipelineStage } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
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
  Globe,
  Briefcase,
  DollarSign,
  Target,
  Tag,
  ArrowLeft,
  Plus,
  Trash2,
  User,
  Sparkles,
  Loader2,
  Link,
} from "lucide-react";
import { useState } from "react";

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
  businessModel: z.string().optional().default(""),
  stage: z.string().optional().default(""),
  fundingHistory: z.string().optional().default(""),
  competitiveLandscape: z.string().optional().default(""),
  sourceUrl: z.string().optional().default(""),
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
  priorCompanies: string;
}

export default function AddDeal() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [founders, setFounders] = useState<FounderForm[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [enrichUrl, setEnrichUrl] = useState("");
  const [enrichName, setEnrichName] = useState("");
  const [isEnriched, setIsEnriched] = useState(false);

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
      pipelineStage: "discovered",
      tags: [],
    },
  });

  const enrichMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = {};
      if (enrichUrl.trim()) body.url = enrichUrl.trim();
      if (enrichName.trim()) body.name = enrichName.trim();
      const res = await apiRequest("POST", "/api/enrich", body);
      return res.json();
    },
    onSuccess: (data) => {
      form.setValue("name", data.name || "");
      form.setValue("oneLiner", data.oneLiner || "");
      form.setValue("description", data.description || "");
      form.setValue("sector", data.sector || "");
      form.setValue("businessModel", data.businessModel || "");
      form.setValue("stage", data.stage || "");
      form.setValue("fundingHistory", data.fundingHistory || "");
      form.setValue("competitiveLandscape", data.competitiveLandscape || "");
      form.setValue("sourceUrl", enrichUrl.trim());
      form.setValue("tags", data.tags || []);

      if (data.founders && data.founders.length > 0) {
        setFounders(data.founders.map((f: any) => ({
          name: f.name || "",
          role: f.role || "",
          bio: f.bio || "",
          linkedinUrl: f.linkedinUrl || "",
          twitterUrl: "",
          priorCompanies: f.priorCompanies || "",
        })));
      }

      setIsEnriched(true);
      toast({ title: "AI enrichment complete", description: "All fields have been populated. Review and submit." });
    },
    onError: (error: Error) => {
      toast({ title: "AI enrichment failed", description: error.message, variant: "destructive" });
    },
  });

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
    setFounders([...founders, { name: "", role: "", bio: "", linkedinUrl: "", twitterUrl: "", priorCompanies: "" }]);
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

  const handleEnrich = () => {
    if (!enrichUrl.trim() && !enrichName.trim()) return;
    enrichMutation.mutate();
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

      <div className="mb-6">
        <h2 className="text-xl font-semibold tracking-tight" data-testid="text-page-title">Add New Deal</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Let the AI agent research and populate deal fields, or fill them in manually.
        </p>
      </div>

      {!isEnriched && (
        <Card className="p-5 mb-6 border-primary/20 bg-primary/[0.02]">
          <h3 className="text-xs uppercase tracking-wider text-primary font-medium mb-4 flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5" />
            AI Auto-Enrichment
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            Paste a URL or company name and the AI agent will automatically fill in all fields below.
          </p>
          <div className="space-y-3">
            <div className="relative">
              <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={enrichUrl}
                onChange={(e) => setEnrichUrl(e.target.value)}
                placeholder="https://company-website.com"
                className="pl-9"
                onKeyDown={(e) => e.key === "Enter" && handleEnrich()}
                disabled={enrichMutation.isPending}
                data-testid="input-enrich-url"
              />
            </div>
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <Input
              value={enrichName}
              onChange={(e) => setEnrichName(e.target.value)}
              placeholder="Company name (e.g. Stripe, Figma)"
              onKeyDown={(e) => e.key === "Enter" && handleEnrich()}
              disabled={enrichMutation.isPending}
              data-testid="input-enrich-name"
            />

            {enrichMutation.isPending && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <div>
                  <p className="text-sm font-medium">AI Agent is researching...</p>
                  <p className="text-xs text-muted-foreground">Extracting company info, founders, sector, competitive landscape, and more</p>
                </div>
              </div>
            )}

            <Button
              type="button"
              onClick={handleEnrich}
              disabled={(!enrichUrl.trim() && !enrichName.trim()) || enrichMutation.isPending}
              className="w-full"
              data-testid="button-enrich"
            >
              {enrichMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  Enriching...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-1.5" />
                  Enrich with AI
                </>
              )}
            </Button>
          </div>
        </Card>
      )}

      {isEnriched && (
        <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
          <Sparkles className="w-4 h-4 text-green-600" />
          <p className="text-sm text-green-700 dark:text-green-400">
            AI enrichment complete — review the pre-filled fields below and submit.
          </p>
        </div>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card className="p-5">
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
            </div>
          </Card>

          <Card className="p-5">
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
          </Card>

          <Card className="p-5">
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
          </Card>

          <Card className="p-5">
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
          </Card>

          <Card className="p-5">
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
          </Card>

          <div className="flex justify-end gap-3 pb-8">
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
