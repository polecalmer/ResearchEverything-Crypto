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
import { Plus, Loader2, Sparkles } from "lucide-react";

export function QuickCapture() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const enrichMutation = useMutation({
    mutationFn: async () => {
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
              <Sparkles className="w-4 h-4 text-primary" />
              AI Quick Capture
            </DialogTitle>
            <DialogDescription>
              Drop any link or text — a company site, tweet, founder's profile, blog post, or just a name. The AI agent will figure out the company and fill in everything.
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
              <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <div>
                  <p className="text-sm font-medium">AI Agent is researching...</p>
                  <p className="text-xs text-muted-foreground">Identifying the company and extracting deal intelligence</p>
                </div>
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
                  Enriching with AI...
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
