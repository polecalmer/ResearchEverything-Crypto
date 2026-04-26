/**
 * Side-effect entry point that registers every built-in plugin.
 *
 * Imported once at the top of session-research-agent.ts. Adding a new plugin
 * means: write the plugin module, import it here, and the agent loop picks
 * it up automatically — no edits to TOOLS, executeTool, parseArtifacts, or
 * TOOL_LABELS required.
 */
import { registerToolPlugin, registerArtifactPlugin } from "./registry";
import {
  BACKTEST_TOOL_DEF,
  BACKTEST_TOOL_NAME,
  BACKTEST_TOOL_LABEL,
  executeBacktestTool,
  parseBacktestArtifact,
} from "../backtest/sessions-plugin";

registerToolPlugin({
  def: BACKTEST_TOOL_DEF,
  label: BACKTEST_TOOL_LABEL,
  execute: executeBacktestTool,
});

registerArtifactPlugin({
  type: "backtest_result",
  parse: parseBacktestArtifact,
  icon: "🧪",
});

export * from "./registry";
