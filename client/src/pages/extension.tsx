import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, Chrome, MousePointerClick, Zap, Settings, ArrowRight, CheckCircle2 } from "lucide-react";

const steps = [
  {
    icon: Download,
    title: "Download the Extension",
    description: 'Download the extension folder from this project and load it in Chrome via chrome://extensions with "Developer mode" enabled.',
  },
  {
    icon: Settings,
    title: "Set Your Dashboard URL",
    description: "Click the extension icon in your browser toolbar and enter this dashboard's URL to connect it.",
  },
  {
    icon: MousePointerClick,
    title: 'Right-Click "Add to BookMark"',
    description: "Right-click on any webpage, link, or selected text and choose \"Add to BookMark\" from the context menu.",
  },
  {
    icon: CheckCircle2,
    title: "Deal Captured Instantly",
    description: "A floating card confirms the capture. The deal appears in your pipeline immediately, ready for enrichment.",
  },
];

export default function ExtensionPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto h-full overflow-y-auto">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center">
            <Zap className="w-6 h-6 text-primary-foreground" />
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight" data-testid="text-page-title">
              Browser Extension
            </h2>
            <p className="text-sm text-muted-foreground">
              Capture deals from anywhere on the web
            </p>
          </div>
        </div>
      </div>

      <Card className="p-6 mb-6">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <h3 className="text-sm font-semibold mb-2">Right-Click to Capture</h3>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              The BookMark Chrome extension adds a right-click context menu to every webpage.
              See a company you're interested in? Right-click and select "Add to BookMark" - the deal
              is captured instantly with the page URL, and a floating card confirms it without
              leaving the page.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary">Chrome</Badge>
              <Badge variant="secondary">Manifest V3</Badge>
              <Badge variant="outline">Free</Badge>
            </div>
          </div>
          <div className="w-48 h-32 rounded-lg bg-accent flex items-center justify-center flex-shrink-0">
            <div className="text-center">
              <Chrome className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-[10px] text-muted-foreground">Chrome Extension</p>
            </div>
          </div>
        </div>
      </Card>

      <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-4">
        Setup Instructions
      </h3>

      <div className="space-y-3 mb-8">
        {steps.map((step, index) => (
          <div
            key={index}
            className="flex items-start gap-4 p-4 rounded-lg bg-accent/30"
            data-testid={`step-${index + 1}`}
          >
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-xs font-bold text-primary">{index + 1}</span>
            </div>
            <div className="min-w-0">
              <h4 className="text-sm font-medium mb-1">{step.title}</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">{step.description}</p>
            </div>
          </div>
        ))}
      </div>

      <Card className="p-5">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3">
          Loading the Extension in Chrome
        </h3>
        <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside leading-relaxed">
          <li>Open Chrome and navigate to <code className="bg-accent px-1.5 py-0.5 rounded text-xs font-mono">chrome://extensions</code></li>
          <li>Enable <strong>"Developer mode"</strong> in the top-right corner</li>
          <li>Click <strong>"Load unpacked"</strong> and select the <code className="bg-accent px-1.5 py-0.5 rounded text-xs font-mono">extension</code> folder from this project</li>
          <li>Click the extension icon in your toolbar and enter your dashboard URL</li>
          <li>Right-click on any page to start capturing deals</li>
        </ol>
      </Card>

      <div className="mt-6 pb-8">
        <p className="text-xs text-muted-foreground text-center">
          The extension connects to your dashboard via API. Your dashboard URL must be accessible from your browser.
        </p>
      </div>
    </div>
  );
}
