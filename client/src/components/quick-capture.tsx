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
import { Plus, Link, Loader2, Sparkles } from "lucide-react";

export function QuickCapture() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const enrichMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = {};
      if (url.trim()) body.url = url.trim();
      if (name.trim()) body.name = name.trim();
      const res = await apiRequest("POST", "/api/companies/enrich-and-create", body);
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
    setUrl("");
    setName("");
  };

  const handleSubmit = () => {
    if (!url.trim() && !name.trim()) return;
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
              Paste a URL or company name. Our AI agent will automatically research and populate all deal fields.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Company URL</label>
              <div className="relative">
                <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com"
                  className="pl-9"
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  autoFocus
                  disabled={enrichMutation.isPending}
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
                placeholder="e.g. Stripe, Figma, Vercel"
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                disabled={enrichMutation.isPending}
                data-testid="input-capture-name"
              />
            </div>

            {enrichMutation.isPending && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <div>
                  <p className="text-sm font-medium">AI Agent is researching...</p>
                  <p className="text-xs text-muted-foreground">Extracting company info, founders, sector, and competitive landscape</p>
                </div>
              </div>
            )}

            <Button
              onClick={handleSubmit}
              disabled={(!url.trim() && !name.trim()) || enrichMutation.isPending}
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
