/**
 * SessionSidePanel — right-hand 40% column of the split-screen session UX.
 *
 * Layout:
 *   Top 70%     = ArtifactsPanel (latest version of each artifact, pinned)
 *   Bottom 30%  = DownloadsPanel (file_download artifacts) + IterationPanel
 *                 (round counter, mode, playbook)
 *
 * "Always on, doesn't render anything when not in use" — when the session
 * has no artifacts, all three sub-panels show nothing (no headers, no
 * placeholders) so the right column is empty space. The 60/40 split stays
 * fixed; we don't collapse the layout. This keeps the chat column width
 * stable across iteration rounds (jumping width as artifacts appear /
 * disappear would feel like the layout is flinching).
 *
 * Reads messages from props; computes latest artifacts via the helpers
 * in client/src/lib/research-utils.ts (collectSessionArtifacts +
 * getLatestArtifacts).
 */

import { useMemo, useState } from "react";
import { Repeat2, Check, Loader2, Circle, FileSpreadsheet, FileImage, FileText, File as FileIcon, AlertCircle } from "lucide-react";
import type { Artifact, SessionMessage, ResearchMode, ThinkingStep } from "@/lib/research-utils";
import { collectSessionArtifacts, getLatestArtifacts } from "@/lib/research-utils";
import { getAuthHeaders } from "@/lib/queryClient";
import {
  InlineChart,
  InlineTable,
  MetricCards,
  FileDownloadBlock,
} from "./research-artifacts";

interface SessionSidePanelProps {
  messages: SessionMessage[];
  isStreaming: boolean;
  thinkingSteps?: ThinkingStep[];
  currentMode?: ResearchMode | null;
  currentRound?: number;
  totalRounds?: number;
}

export function SessionSidePanel(props: SessionSidePanelProps) {
  const allArtifacts = useMemo(
    () => collectSessionArtifacts(props.messages),
    [props.messages],
  );
  const latestArtifacts = useMemo(
    () => getLatestArtifacts(allArtifacts),
    [allArtifacts],
  );

  // Filter file_downloads (handled by DownloadsPanel separately) from the
  // main ArtifactsPanel so each artifact appears in the right pane only.
  const renderableArtifacts = latestArtifacts.filter(
    (a) => a && a.type !== "file_download" && a.type !== "callout" && a.type !== "sources",
  );
  const fileArtifacts = latestArtifacts.filter((a) => a?.type === "file_download");

  const hasContent =
    renderableArtifacts.length > 0 ||
    fileArtifacts.length > 0 ||
    props.isStreaming;

  return (
    <div
      className="flex flex-col h-full bg-card/20 border-l border-border/30"
      data-testid="session-side-panel"
    >
      {/* Artifacts take the bulk of the right pane. Files chip strip sits
       *  at the BOTTOM as a small horizontal row (Google-Drive feel —
       *  small clickable file chip you can open). IterationPanel is a
       *  thin status line at the very bottom.
       *  While streaming, a ProgressPanel renders above the artifacts
       *  showing high-level phase progression (Understanding / Planning /
       *  Researching / Analyzing / Composing) — disappears the moment
       *  isStreaming goes false. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {props.isStreaming && (
          <ProgressPanel
            isStreaming={props.isStreaming}
            steps={props.thinkingSteps || []}
            hasArtifacts={latestArtifacts.length > 0}
          />
        )}
        {hasContent ? (
          <ArtifactsPanel artifacts={renderableArtifacts} isStreaming={props.isStreaming} />
        ) : (
          <div aria-hidden="true" />
        )}
      </div>

      {fileArtifacts.length > 0 && (
        <div className="border-t border-border/30 shrink-0">
          <DownloadsPanel files={fileArtifacts} />
        </div>
      )}

      {hasContent && (
        <div className="border-t border-border/20 shrink-0">
          <IterationPanel
            isStreaming={props.isStreaming}
            currentMode={props.currentMode}
            currentRound={props.currentRound}
            totalRounds={props.totalRounds}
            artifactCount={latestArtifacts.length}
          />
        </div>
      )}
    </div>
  );
}

/* ────────────────── ProgressPanel ────────────────── */

/** Live progress display while a session is streaming. Maps the granular
 *  ThinkingStep events (tool_start, sub_question_progress, synthesis_started,
 *  etc.) to five high-level phases — Understanding / Planning / Researching /
 *  Analyzing / Composing — and renders them as a checklist.
 *
 *  Phase progression:
 *    Understanding (default current)
 *    → Planning      when first "Plan:" step fires
 *    → Researching   when first tool_start fires
 *    → Analyzing     when sub_question_progress or analyzing fires
 *    → Composing     when synthesis_started fires
 *    All done        when isStreaming flips false OR a "complete" step lands
 *
 *  Hides entirely once streaming stops (artifacts take over the pane). */
type PhaseId = "understanding" | "planning" | "researching" | "analyzing" | "composing";
type PhaseState = "pending" | "current" | "done";
interface Phase {
  id: PhaseId;
  label: string;
  state: PhaseState;
}

function derivePhases(steps: ThinkingStep[], isStreaming: boolean): Phase[] {
  const phases: Phase[] = [
    { id: "understanding", label: "Understanding", state: "current" },
    { id: "planning", label: "Planning", state: "pending" },
    { id: "researching", label: "Researching", state: "pending" },
    { id: "analyzing", label: "Analyzing", state: "pending" },
    { id: "composing", label: "Composing", state: "pending" },
  ];

  if (!steps || steps.length === 0) return phases;

  const hasPlanning = steps.some(
    (s) => /^plan\b/i.test(s.label || "") || /sub-questions/i.test(s.label || ""),
  );
  const hasTool = steps.some(
    (s) => s.type === "tool_start" || s.type === "tool_result",
  );
  const hasSub = steps.some(
    (s) =>
      s.type === "sub_question_started" ||
      s.type === "sub_question_progress" ||
      s.type === "sub_question_done" ||
      s.type === "analyzing",
  );
  const hasSynth = steps.some((s) => s.type === "synthesis_started");
  const hasComplete = steps.some((s) => s.type === "complete");
  const allDone = !isStreaming || hasComplete;

  if (allDone) {
    phases.forEach((p) => (p.state = "done"));
    return phases;
  }

  // Walk forward to the latest phase that has any signal — that's
  // "current"; everything before it is "done", everything after "pending".
  let latestIdx = 0;
  if (hasPlanning) latestIdx = 1;
  if (hasTool) latestIdx = 2;
  if (hasSub) latestIdx = 3;
  if (hasSynth) latestIdx = 4;

  for (let i = 0; i < phases.length; i++) {
    phases[i].state = i < latestIdx ? "done" : i === latestIdx ? "current" : "pending";
  }
  return phases;
}

function ProgressPanel({
  steps,
  isStreaming,
  hasArtifacts,
}: {
  steps: ThinkingStep[];
  isStreaming: boolean;
  hasArtifacts: boolean;
}) {
  const phases = useMemo(() => derivePhases(steps, isStreaming), [steps, isStreaming]);
  // Show "DONE" label only when everything is in the `done` state — same
  // visual style as the reference image (small uppercase tag at top-right).
  const allDone = phases.every((p) => p.state === "done");
  const stateLabel = allDone ? "DONE" : "RUNNING";

  return (
    <div
      className={`px-4 py-3 ${hasArtifacts ? "border-b border-border/30" : ""}`}
      data-testid="progress-panel"
    >
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[9.5px] uppercase tracking-[0.14em] font-medium text-muted-foreground/60">
          {stateLabel}
        </span>
      </div>
      <ul className="space-y-2">
        {phases.map((p) => (
          <li key={p.id} className="flex items-center gap-2.5 text-[12px]">
            <span className="shrink-0 inline-flex items-center justify-center w-4 h-4">
              {p.state === "done" ? (
                <Check className="w-3 h-3 text-emerald-500/70" strokeWidth={2.5} />
              ) : p.state === "current" ? (
                <Loader2 className="w-3 h-3 animate-spin text-foreground/70" />
              ) : (
                <Circle className="w-2.5 h-2.5 text-muted-foreground/30" strokeWidth={2} />
              )}
            </span>
            <span
              className={
                p.state === "done"
                  ? "text-muted-foreground/65"
                  : p.state === "current"
                  ? "text-foreground/90"
                  : "text-muted-foreground/40"
              }
            >
              {p.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ────────────────── ArtifactsPanel ────────────────── */

function ArtifactsPanel({
  artifacts,
  isStreaming,
}: {
  artifacts: Artifact[];
  isStreaming: boolean;
}) {
  if (artifacts.length === 0 && !isStreaming) return <div aria-hidden="true" />;

  // No "Artifacts · N" header label — keep the pane clean per spec.
  // Each artifact has its own title so the section identity is implicit.
  return (
    <div className="px-4 py-3" data-testid="artifacts-panel">
      {artifacts.length === 0 && isStreaming && (
        <div className="text-[11px] text-muted-foreground/40 italic">Working…</div>
      )}
      <div className="space-y-5">
        {artifacts.map((art, i) => (
          <ArtifactCard key={art.artifactId || `art-${i}`} artifact={art} />
        ))}
      </div>
    </div>
  );
}

/** Renders a single artifact in the side pane — NO card chrome. The
 *  inline components (InlineChart, InlineTable, MetricCards) now show
 *  their own titles + thin borders, so a surrounding card frame would
 *  just be visual noise. Version badge (v2/v3/…) renders as a tiny
 *  inline tag at the top-right when present. */
function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const versionLabel =
    typeof artifact.version === "number" && artifact.version > 1
      ? `v${artifact.version}`
      : null;

  return (
    <div className="relative">
      {versionLabel && (
        <span
          className="absolute top-0 right-0 text-[9px] font-mono text-muted-foreground/60"
          aria-label={`version ${versionLabel}`}
        >
          {versionLabel}
        </span>
      )}
      {artifact.type === "chart" && <InlineChart artifact={artifact} compact />}
      {artifact.type === "table" && <InlineTable artifact={artifact} compact />}
      {artifact.type === "metric_cards" && <MetricCards artifact={artifact} />}
    </div>
  );
}

/* ────────────────── DownloadsPanel ────────────────── */

/** Footer-style file downloads pane. Sits as a dedicated small section at
 *  the bottom of the right column (above the IterationPanel status line),
 *  with a thin top border separating it from the artifacts area above.
 *  Each generated file renders as its own row — file-type icon on the
 *  left, filename in the middle, green "done" checkmark on the right.
 *  Modelled after the Google-Drive / Dropbox post-download notification
 *  pattern: small, scannable, clearly distinct as "your files are here".
 *
 *  Empty state is null (not an empty div) so the parent's border-t
 *  separator disappears too when there are no files — keeps the column
 *  tidy when nothing has been generated. */
function DownloadsPanel({ files }: { files: Artifact[] }) {
  if (files.length === 0) return null;
  return (
    <div className="px-3 py-2.5 bg-card/30" data-testid="downloads-panel">
      <div className="text-[9.5px] uppercase tracking-[0.14em] font-medium text-muted-foreground/55 mb-1.5">
        Files generated · {files.length}
      </div>
      <div className="flex flex-col gap-1">
        {files.map((f) => (
          <FileChip key={f.artifactId || f.url} artifact={f} />
        ))}
      </div>
    </div>
  );
}

/** Single file row inside the DownloadsPanel. Layout:
 *
 *    [icon]  filename.xlsx                                   [✓]
 *
 *  Icon is file-type-aware (xlsx/csv → spreadsheet icon in Excel-green,
 *  png → image icon in amber, anything else → generic file icon). The
 *  green check on the right is the "ready to download" status indicator.
 *
 *  AUTH-AWARE DOWNLOAD: we cannot use a raw `<a href download>` because
 *  the download endpoint at /api/research/artifacts/:sid/:filename is
 *  behind `requireAuth`, which expects an Authorization Bearer header
 *  or X-Privy-Token header — neither of which the browser sends on a
 *  plain anchor click. Without this, the endpoint returns a 401 JSON
 *  body which the browser saves as the file content (Google Sheets then
 *  opens `{"message":"Authentication required"}` as a literal cell).
 *
 *  Instead: button → JS fetch with getAuthHeaders() → blob → temporary
 *  anchor click → revoke object URL. Mirrors the rest of the app's
 *  auth pattern. Loading state shown while the fetch is in flight;
 *  error state shows a small icon swap with a tooltip so the user
 *  knows something went wrong instead of a silent failed download. */
function FileChip({ artifact }: { artifact: Artifact }) {
  const subtype = artifact.subtype || "file";
  const filename = artifact.filename || "download";
  const display = artifact.title || filename;
  const sizeBytes = artifact.sizeBytes ?? 0;
  const sizeStr =
    sizeBytes >= 1024 * 1024
      ? `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`
      : sizeBytes > 0
        ? `${Math.max(1, Math.round(sizeBytes / 1024))} KB`
        : "";

  const [state, setState] = useState<"idle" | "downloading" | "error">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // Excel green for spreadsheet-shaped files; amber for PNG; neutral
  // otherwise. Matches the office-file colour convention without being
  // loud (we keep the icon-only colour, not the background).
  const Icon =
    subtype === "xlsx" || subtype === "csv"
      ? FileSpreadsheet
      : subtype === "png"
        ? FileImage
        : FileIcon;
  const iconColor =
    subtype === "xlsx" || subtype === "csv"
      ? "hsl(142 65% 38%)"
      : subtype === "png"
        ? "hsl(40 80% 50%)"
        : "hsl(var(--muted-foreground))";

  async function handleDownload() {
    if (!artifact.url || state === "downloading") return;
    setState("downloading");
    setErrMsg(null);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(artifact.url, { headers: authHeaders });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 100)}` : ""}`);
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Defer revoke so the browser has time to begin the download
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setState("idle");
    } catch (err: any) {
      setState("error");
      setErrMsg(err?.message || "Download failed");
    }
  }

  if (!artifact.url) return null;
  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={state === "downloading"}
      className="group/chip flex items-center gap-2.5 px-2.5 py-1.5 rounded border border-border/30 bg-background hover:bg-card/60 hover:border-border/50 transition-colors text-left disabled:opacity-70 disabled:cursor-wait"
      data-testid={`file-chip-${subtype}`}
      title={
        state === "error"
          ? `Download failed — ${errMsg ?? "see console"}`
          : sizeStr
            ? `${display} · ${sizeStr}`
            : display
      }
    >
      <Icon
        className="w-4 h-4 shrink-0"
        style={{ color: iconColor }}
        aria-hidden="true"
      />
      <span className="text-[12px] text-foreground truncate flex-1 min-w-0">
        {display}
      </span>
      {state === "downloading" ? (
        <Loader2
          className="w-4 h-4 shrink-0 animate-spin text-muted-foreground"
          aria-label="downloading"
        />
      ) : state === "error" ? (
        <span
          className="w-4 h-4 shrink-0 rounded-full flex items-center justify-center"
          style={{ background: "hsl(0 70% 50%)" }}
          aria-label="download failed"
        >
          <AlertCircle className="w-2.5 h-2.5 text-white" strokeWidth={3} />
        </span>
      ) : (
        <span
          className="w-4 h-4 shrink-0 rounded-full flex items-center justify-center"
          style={{ background: "hsl(142 70% 42%)" }}
          aria-label="ready to download"
        >
          <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
        </span>
      )}
    </button>
  );
}

// ValidatorNotesPanel removed 2026-05-17: validator callouts are
// filtered out of the inline chat rendering (via isValidatorCallout)
// and intentionally have no UI representation anywhere. The agent's
// validation layer still runs and the server logs the warnings; users
// don't see them in the chat surface. If we need to expose them again,
// bring this component back from git history.

/* ────────────────── IterationPanel ────────────────── */

function IterationPanel({
  isStreaming,
  currentMode,
  currentRound,
  totalRounds,
  artifactCount,
}: {
  isStreaming: boolean;
  currentMode?: ResearchMode | null;
  currentRound?: number;
  totalRounds?: number;
  artifactCount: number;
}) {
  const status = isStreaming ? "Running" : artifactCount > 0 ? "Idle" : "—";

  return (
    <div
      className="px-4 py-2 text-[10px] text-muted-foreground/70 flex items-center justify-between"
      data-testid="iteration-panel"
    >
      <div className="flex items-center gap-2">
        <Repeat2 className="w-3 h-3" />
        <span>{status}</span>
        {currentMode && (
          <>
            <span className="opacity-40">·</span>
            <span className="uppercase tracking-wider">{currentMode}</span>
          </>
        )}
      </div>
      {typeof currentRound === "number" && typeof totalRounds === "number" && totalRounds > 0 && (
        <span className="font-mono">
          R{currentRound}/{totalRounds}
        </span>
      )}
    </div>
  );
}
