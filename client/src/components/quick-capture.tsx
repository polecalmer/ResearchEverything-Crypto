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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PIPELINE_STAGES, STAGE_LABELS, type PipelineStage } from "@shared/schema";
import { Plus, Link, Loader2, Zap, ArrowRight } from "lucide-react";

export function QuickCapture() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [oneLiner, setOneLiner] = useState("");
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>("discovered");
  const [step, setStep] = useState<"url" | "details">("url");
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/companies", {
        name,
        oneLiner,
        sourceUrl: url,
        pipelineStage,
      });
      return res.json();
    },
    onSuccess: (company) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: `"${name}" added to pipeline` });
      resetAndClose();
      navigate(`/companies/${company.id}`);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add deal", description: error.message, variant: "destructive" });
    },
  });

  const resetAndClose = () => {
    setOpen(false);
    setUrl("");
    setName("");
    setOneLiner("");
    setPipelineStage("discovered");
    setStep("url");
  };

  const handleUrlNext = () => {
    if (!url.trim() && !name.trim()) return;
    if (url.trim() && !name.trim()) {
      try {
        const parsed = new URL(url.trim());
        const hostname = parsed.hostname.replace("www.", "");
        const parts = hostname.split(".");
        const guessedName = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
        setName(guessedName);
      } catch {
        setName("");
      }
    }
    setStep("details");
  };

  const handleSubmit = () => {
    if (!name.trim() || !oneLiner.trim()) return;
    createMutation.mutate();
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
              <Zap className="w-4 h-4 text-primary" />
              Quick Capture
            </DialogTitle>
            <DialogDescription>
              {step === "url"
                ? "Paste a URL or enter a company name to add to your dealflow."
                : "Add some details about this deal."}
            </DialogDescription>
          </DialogHeader>

          {step === "url" ? (
            <div className="space-y-4 pt-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Source URL</label>
                <div className="relative">
                  <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://example.com"
                    className="pl-9"
                    onKeyDown={(e) => e.key === "Enter" && handleUrlNext()}
                    autoFocus
                    data-testid="input-capture-url"
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">or</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Company Name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Acme Inc"
                  onKeyDown={(e) => e.key === "Enter" && handleUrlNext()}
                  data-testid="input-capture-name"
                />
              </div>
              <Button
                onClick={handleUrlNext}
                disabled={!url.trim() && !name.trim()}
                className="w-full"
                data-testid="button-capture-next"
              >
                Next
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            </div>
          ) : (
            <div className="space-y-4 pt-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Company Name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Company name"
                  data-testid="input-capture-name-detail"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">One-Liner *</label>
                <Input
                  value={oneLiner}
                  onChange={(e) => setOneLiner(e.target.value)}
                  placeholder="What they do in one sentence"
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  data-testid="input-capture-oneliner"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Pipeline Stage</label>
                <Select value={pipelineStage} onValueChange={(v) => setPipelineStage(v as PipelineStage)}>
                  <SelectTrigger data-testid="select-capture-stage">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PIPELINE_STAGES.map((stage) => (
                      <SelectItem key={stage} value={stage}>{STAGE_LABELS[stage]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setStep("url")}
                  className="flex-1"
                  data-testid="button-capture-back"
                >
                  Back
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={!name.trim() || !oneLiner.trim() || createMutation.isPending}
                  className="flex-1"
                  data-testid="button-capture-submit"
                >
                  {createMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    "Add to Dealflow"
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
