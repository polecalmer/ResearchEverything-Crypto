import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Plus, Loader2, Sparkles, CheckCircle2, Search, FileSearch, ShieldCheck } from "lucide-react";
import type { EnrichmentStage } from "@/lib/enrichment";

const PIPELINE_AGENTS = [
  { key: "identifier", icon: Search, label: "Identifier" },
  { key: "researcher", icon: FileSearch, label: "Research" },
  { key: "verify_clean", icon: ShieldCheck, label: "Verify & Clean" },
] as const;

export function QuickCapture() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [pipelineStages, setPipelineStages] = useState<EnrichmentStage[]>([]);
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const enrichMutation = useMutation({
    mutationFn: async () => {
      setPipelineStages([]);
      const res = await apiRequest("POST", "/api/companies/enrich-and-create", {
        input: input.trim(),
      });
      return res.json();
    },
    onSuccess: (company) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: `"${company.name}" added with AI enrichment` });
      resetAndClose();
      navigate(`/companies/${company.id}`);
    },
    onError: (error: Error) => {
      toast({ title: "Enrichment failed", description: error.message, variant: "destructive" });
    },
  });

  const resetAndClose = () => {
    setOpen(false);
    setInput("");
    setPipelineStages([]);
  };

  const handleSubmit = () => {
    if (!input.trim()) return;
    enrichMutation.mutate();
  };

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 rounded-full w-14 h-14 shadow-lg"
        size="icon"
        data-testid="button-quick-capture"
      >
        <Plus className="w-6 h-6" />
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (!v) resetAndClose(); else setOpen(true); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-foreground" />
              AI Quick Capture
            </DialogTitle>
            <DialogDescription>
              Drop any link or text. A team of 3 AI agents will identify the company, research it, then verify and clean the output.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">URL, name, or any reference</label>
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="e.g. https://x.com/elonmusk, stripe.com, a blog link..."
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                autoFocus
                disabled={enrichMutation.isPending}
                data-testid="input-capture"
              />
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Works with: company websites, tweets, X/LinkedIn profiles, blog posts, Product Hunt, GitHub repos, or plain company names
              </p>
            </div>

            {enrichMutation.isPending && (
              <div className="space-y-1.5 p-3 rounded-lg bg-accent/50 border border-border" data-testid="quick-pipeline-progress">
                <p className="text-xs font-medium text-foreground mb-2">Agent Pipeline</p>
                <div className="flex items-center gap-2">
                  {PIPELINE_AGENTS.map(({ key, icon: Icon, label }) => {
                    const isActive = false;
                    return (
                      <div key={key} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Loader2 className="w-3 h-3 animate-spin text-foreground" />
                        <span>{label}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  3 agents are working: identifying → researching → verifying & cleaning
                </p>
              </div>
            )}

            <Button
              onClick={handleSubmit}
              disabled={!input.trim() || enrichMutation.isPending}
              className="w-full"
              data-testid="button-capture-submit"
            >
              {enrichMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  3 agents working...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-1.5" />
                  Add &amp; Enrich with AI
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
