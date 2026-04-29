/**
 * Financial-statement prompt detector.
 *
 * Empirically chart mode produces sharper, more grounded financial
 * statements than free-form research mode (chart mode's artifact-
 * emission contract acts as a forcing function). For prompts that
 * read as "build me a financial statement / income statement / P&L",
 * default to chart mode unless the user explicitly forced another mode.
 *
 * Conservative on purpose: only fires for clear FS/valuation prompts,
 * never overrides an explicit user mode pick.
 */

const FS_PROMPT_RE = /\b(financial statement|income statement|p&l|p\s*and\s*l|build (me )?a (financial|income|p\s*&\s*l|p and l)|gaap|ebit(da)?|net income|valuation multiples?|build a finstat|fin\s*stat|fundamental analysis|fundamental statement)\b/i;

export function isFinancialStatementPrompt(message: string): boolean {
  if (!message) return false;
  return FS_PROMPT_RE.test(message);
}

/** Map a user prompt to a structured shape (financial_statement,
 *  valuation_dashboard, etc.). Used by output-requirements lookup so
 *  the brain can attach "this shape MUST include these outputs" rules
 *  to specific prompt categories. Returns null when no shape matches. */
export function detectPromptShape(message: string): string | null {
  if (isFinancialStatementPrompt(message)) return "financial_statement";
  return null;
}

/** Resolve effective mode given user input, explicit forceMode, and
 *  isDataMode. Returns the new mode + whether routing fired. */
export function resolveEffectiveMode(
  userMessage: string,
  explicitMode: "quick" | "focused" | "deep" | "chart" | undefined,
  isDataMode: boolean,
): {
  mode: "quick" | "focused" | "deep" | "chart" | undefined;
  routedToChart: boolean;
  reason: string;
} {
  // Explicit user pick always wins.
  if (explicitMode) {
    return { mode: explicitMode, routedToChart: false, reason: "explicit forceMode" };
  }
  // Existing data-mode toggle wins.
  if (isDataMode) {
    return { mode: "chart", routedToChart: false, reason: "isDataMode toggle" };
  }
  // Auto-route financial-statement prompts to chart.
  if (isFinancialStatementPrompt(userMessage)) {
    return {
      mode: "chart",
      routedToChart: true,
      reason: "financial-statement prompt detected — routing to chart mode for tighter data discipline",
    };
  }
  return { mode: undefined, routedToChart: false, reason: "no auto-routing match" };
}
