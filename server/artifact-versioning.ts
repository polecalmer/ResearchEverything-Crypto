/**
 * Artifact identity + versioning.
 *
 * Each artifact a research session emits gets a stable `artifactId` and
 * a sequential `version`. Two artifacts in the same session with the
 * same artifactId are the SAME logical thing — v1, v2, v3, etc. — even
 * though they're emitted across different messages.
 *
 * Why: the split-screen ArtifactsPanel renders "the latest version of
 * each artifact" pinned in a side panel, not the full per-message
 * history. Iterating on a financial model ("change the discount rate
 * to 8%") should UPDATE the same artifact card in the panel, not pile
 * up new ones below.
 *
 * Identity is deterministic — derived from (session_id, type, subtype,
 * primary subject entity OR normalised title) — so we don't need the
 * agent to track ids. The agent emits whatever it emits; this module
 * computes the id at message-persistence time.
 *
 * The signature is intentionally COARSE so titles drifting across
 * iterations ("HYPE Valuation Model" → "HYPE Valuation Model v2" →
 * "Updated HYPE Valuation") all collapse to one artifact. Too-fine a
 * signature defeats the whole point (each iteration would be a new
 * artifact).
 */

import * as crypto from "node:crypto";

export interface ArtifactWithVersion {
  type: string;
  artifactId?: string;
  version?: number;
  subtype?: string;
  title?: string;
  filename?: string;
  data?: any;
  [k: string]: any;
}

/** Lowercase + strip version-like suffixes / qualifiers so iteration
 *  titles collapse to a common key. "HYPE Valuation Model v2" →
 *  "hype valuation model". Cap at 50 chars so very long titles don't
 *  fight the identity bucketing. */
function normaliseTitle(title?: string): string {
  if (!title || typeof title !== "string") return "";
  return title
    .toLowerCase()
    .replace(/\b(v\d+|version\s+\d+|updated|revised|new|final|alt|alternative)\b/g, "")
    .replace(/[—–-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50);
}

/** Extract a 'primary subject' from the artifact's content. For charts,
 *  read the first yAxis label / dataKey. For tables, the first column.
 *  For file_download, the filename. Falls back to title. Used as the
 *  most-specific component of the identity signature. */
function extractPrimarySubject(artifact: ArtifactWithVersion): string {
  if (artifact.type === "file_download") {
    return (artifact.filename || artifact.title || "").toLowerCase().slice(0, 40);
  }
  if (artifact.type === "chart" && artifact.chartConfig?.yAxes?.[0]) {
    return String(artifact.chartConfig.yAxes[0].label || artifact.chartConfig.yAxes[0].dataKey || "").toLowerCase().slice(0, 40);
  }
  if (artifact.type === "table" && Array.isArray(artifact.columns) && artifact.columns[0]) {
    return String(artifact.columns[0]).toLowerCase().slice(0, 40);
  }
  if (artifact.type === "metric_cards" && Array.isArray(artifact.data) && artifact.data[0]?.label) {
    return String(artifact.data[0].label).toLowerCase().slice(0, 40);
  }
  return normaliseTitle(artifact.title);
}

/** Compute the stable identity signature for an artifact within a
 *  session. Two emissions with the same signature are the same logical
 *  artifact. */
function computeArtifactId(sessionId: number | string, artifact: ArtifactWithVersion): string {
  const type = artifact.type || "unknown";
  const subtype = artifact.subtype || "";
  const subject = extractPrimarySubject(artifact);
  const titleNorm = normaliseTitle(artifact.title);

  // Compose a stable key string. Hash it down to a short prefix the
  // frontend can show in tooltips without overwhelming the UI.
  const key = `${sessionId}::${type}::${subtype}::${subject || titleNorm}`;
  return crypto.createHash("sha1").update(key).digest("hex").slice(0, 10);
}

/** For each artifact in `newArtifacts`, derive its artifactId from
 *  the session + content signature, then look up how many existing
 *  artifacts in the session share that id and bump the version to
 *  count+1. Mutates the artifact objects in place. Side-effect-free
 *  on existing artifacts. */
export function assignArtifactVersions(
  sessionId: number | string,
  newArtifacts: ArtifactWithVersion[],
  priorArtifacts: ArtifactWithVersion[],
): void {
  if (!Array.isArray(newArtifacts) || newArtifacts.length === 0) return;

  // Build a count of each artifactId already seen in this session.
  const priorVersionCount = new Map<string, number>();
  for (const prev of priorArtifacts || []) {
    const id = prev?.artifactId;
    if (typeof id === "string" && id.length > 0) {
      priorVersionCount.set(id, (priorVersionCount.get(id) ?? 0) + 1);
    }
  }

  for (const art of newArtifacts) {
    if (!art || typeof art !== "object") continue;
    // Skip artifacts that shouldn't be versioned (callouts are usually
    // ephemeral warnings/notes, not iterable deliverables).
    if (art.type === "callout") continue;

    const id = computeArtifactId(sessionId, art);
    art.artifactId = id;
    const prior = priorVersionCount.get(id) ?? 0;
    art.version = prior + 1;
    // Bump local count so multiple artifacts of the same identity within
    // ONE message also get distinct versions (rare but possible — e.g.
    // agent emits the same chart twice in one turn).
    priorVersionCount.set(id, prior + 1);
  }
}

/** Flatten the per-message artifacts column across all messages in a
 *  session into a single chronological list. Used by getLatestArtifacts
 *  and by the assignArtifactVersions caller (to know what's already
 *  been emitted). */
export function collectArtifactsFromMessages(
  messages: Array<{ artifacts?: any }>,
): ArtifactWithVersion[] {
  const out: ArtifactWithVersion[] = [];
  for (const msg of messages || []) {
    const arts = Array.isArray(msg?.artifacts) ? msg.artifacts : [];
    for (const a of arts) {
      if (a && typeof a === "object") out.push(a as ArtifactWithVersion);
    }
  }
  return out;
}

/** Reduce a list of artifacts (potentially many versions of the same
 *  logical artifact) to the LATEST version of each unique artifactId.
 *  Used by the split-screen ArtifactsPanel to render the pinned latest
 *  state without showing every iteration's emission. Preserves the
 *  most-recent occurrence order (newer artifacts higher). */
export function getLatestArtifacts(
  artifacts: ArtifactWithVersion[],
): ArtifactWithVersion[] {
  const byId = new Map<string, ArtifactWithVersion>();
  // Iterate in order so later artifacts overwrite earlier — last write wins.
  // For artifacts without an id, key by a synthetic per-emission id so
  // each one is preserved (no collapsing of legacy un-versioned artifacts).
  for (let i = 0; i < artifacts.length; i++) {
    const a = artifacts[i];
    if (!a) continue;
    const key = a.artifactId || `__unversioned_${i}`;
    byId.set(key, a);
  }
  return Array.from(byId.values());
}
