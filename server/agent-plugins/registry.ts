/**
 * Plugin registry for the session-research-agent loop.
 *
 * Lets feature modules (backtesting, future modules) register tools and
 * artifact types without inline-editing session-research-agent.ts. The agent
 * loop merges static + registered entries at runtime.
 *
 * Each plugin self-registers by importing this file and calling
 * registerToolPlugin / registerArtifactPlugin. The agent loop calls
 * getRegisteredToolDefs(), tryRegisteredToolExecutor(), etc.
 */

export interface ToolPlugin {
  /** Match the shape of the inline TOOLS array entries in session-research-agent.ts. */
  def: any;
  /** Status-line label shown in the UI when the tool is running. */
  label: string;
  /** Returns the JSON string the agent loop hands back to the LLM. */
  execute: (input: any) => Promise<string>;
  /** Optional override for how the label is rendered with input details. */
  renderLabel?: (input: any) => string;
}

export interface ArtifactPlugin {
  type: string;
  /** Parser for `\`\`\`artifact:<type>` JSON blocks → ResearchArtifact-shaped object. */
  parse: (json: any) => any;
  /** Icon used when collapsing artifacts in history-summarisation. */
  icon: string;
}

const toolPlugins: ToolPlugin[] = [];
const artifactPlugins: ArtifactPlugin[] = [];

export function registerToolPlugin(p: ToolPlugin) {
  if (toolPlugins.find(x => x.def?.name === p.def?.name)) return;
  toolPlugins.push(p);
}

export function registerArtifactPlugin(p: ArtifactPlugin) {
  if (artifactPlugins.find(x => x.type === p.type)) return;
  artifactPlugins.push(p);
}

export function getRegisteredToolDefs(): any[] {
  return toolPlugins.map(p => p.def);
}

export function getRegisteredToolLabels(): Record<string, string> {
  return Object.fromEntries(toolPlugins.map(p => [p.def.name, p.label]));
}

export function getRegisteredArtifactTypes(): string[] {
  return artifactPlugins.map(p => p.type);
}

export function getRegisteredArtifactIcons(): Record<string, string> {
  return Object.fromEntries(artifactPlugins.map(p => [p.type, p.icon]));
}

/** Try to execute a tool from the registry. Returns null if no plugin claims
 *  the name, so the caller can fall through to its built-in switch. */
export async function tryRegisteredToolExecutor(name: string, input: any): Promise<string | null> {
  const plugin = toolPlugins.find(p => p.def?.name === name);
  if (!plugin) return null;
  return plugin.execute(input);
}

export function tryRegisteredArtifactParser(type: string, json: any): any | null {
  const plugin = artifactPlugins.find(p => p.type === type);
  if (!plugin) return null;
  return plugin.parse(json);
}

/** Allow callers to render a registered tool's label with input details, if
 *  the plugin defines a custom renderer. Falls back to the static label. */
export function tryRegisteredToolLabel(name: string, input: any): string | null {
  const plugin = toolPlugins.find(p => p.def?.name === name);
  if (!plugin) return null;
  return plugin.renderLabel ? plugin.renderLabel(input) : plugin.label;
}
