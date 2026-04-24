import React from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  /** Optional label shown in the fallback UI, e.g. "chart", "message". */
  label?: string;
  /** Optional custom fallback renderer. Receives the error + a reset callback. */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors in a subtree and renders a small inline fallback
 * instead of blanking the whole page.
 *
 * Wrap chart and message artifacts — a crash in one chart should NOT take
 * down the surrounding session view. This has happened multiple times in
 * prod (React-DOM reconciliation after mutation, bad SVG, hook violations)
 * and the entire page went white each time.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log to console for now. If we wire Sentry/Datadog later, plumb into it.
    console.error(
      `[ErrorBoundary${this.props.label ? `/${this.props.label}` : ""}]`,
      error,
      info?.componentStack,
    );
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);

    return (
      <div
        role="alert"
        className="my-4 rounded-md border border-rose-400/30 bg-rose-500/5 px-4 py-3 text-[12px] text-rose-300/90"
        data-testid={`error-boundary-fallback${this.props.label ? `-${this.props.label}` : ""}`}
      >
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className="h-3.5 w-3.5" />
          <span className="font-medium tracking-tight">
            {this.props.label
              ? `Couldn't render this ${this.props.label}.`
              : "Something failed to render here."}
          </span>
        </div>
        <div className="text-rose-300/60 text-[11px] mb-2 font-mono break-all">
          {this.state.error.message}
        </div>
        <button
          onClick={this.reset}
          className="text-[11px] text-rose-300/80 hover:text-rose-200 underline underline-offset-2"
        >
          Retry
        </button>
      </div>
    );
  }
}
