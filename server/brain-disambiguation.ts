// Extract architectural / disambiguation facts from agent prose that the
// numeric-fact extractor doesn't catch. Closes the ingestion gap that
// surfaced in the TradeXYZ/TRADE incident:
//
//   May 6 agent prose said: "The 'TRADE' ticker on CoinGecko ($0.041,
//   $4.2M FDV) is an entirely unrelated token."
//
//   The brain captured 15 numeric facts about TradeXYZ (ARR, fees,
//   volume, etc.) but DROPPED the disambiguation. Next session,
//   nothing in the brain prevented the same TRADE-token confusion
//   from recurring.
//
// Patterns this module scans for:
//   - "X has no token" / "X is not tokenised" / "X does not have a token"
//   - "Don't confuse X with Y"
//   - "The Z ticker on Y is an (entirely) unrelated token"
//   - "X is unrelated to Y" / "X is a different token from Y"
//
// Output: synthetic brain-fact entries that the existing merge path
// in research-routes.ts already knows how to handle. Tagged with
// source="disambiguation-extractor" so the provenance is clear.

export interface ExtractedDisambiguationFact {
  topic: string;
  fact: string;
  entities: string[];
  source: string;
  confidence: "verified";
  date: string;
}

/* ──────────────────────── Patterns ────────────────────────
 * Each pattern returns one or more facts when it matches. They're tried
 * in order; the same prose passage can be matched by multiple patterns
 * (we dedupe at the end). Patterns are tuned precision-first — we'd
 * rather miss a disambiguation than capture a false one as a "verified"
 * brain fact, because false facts poison future retrieval. */

interface Pattern {
  tag: string;
  re: RegExp;
  toFact: (m: RegExpExecArray, today: string) => ExtractedDisambiguationFact | null;
}

/** Trim and normalise a captured entity name. Strips quotes, trailing
 *  punctuation, leading articles. Returns empty string if nothing
 *  recognisable remains. */
function cleanEntity(raw: string): string {
  if (!raw) return "";
  let s = raw.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
  s = s.replace(/[.,;:!?]+$/, "").trim();
  s = s.replace(/^(the|a|an)\s+/i, "").trim();
  // Reject obvious noise: too long, sentences, mostly non-alpha
  if (s.length === 0 || s.length > 60) return "";
  if (/[.!?]/.test(s)) return "";
  return s;
}

const PATTERNS: ReadonlyArray<Pattern> = [
  // "X has no token" / "X has no native token" / "X does not currently have a separate public token"
  // Optional adverb after "does not" (currently / presently / yet);
  // optional zero-to-three adjectives before "token" so real prose like
  // "a separate public token" matches.
  {
    tag: "no-token",
    re: /\b([A-Z][\w.-]{1,40}(?:\s+[A-Z][\w.-]{1,40}){0,3})\s+(?:has\s+no|does\s+not\s+(?:currently\s+|presently\s+|yet\s+)?have\s+(?:a\s+|any\s+)?|doesn'?t\s+(?:currently\s+|presently\s+|yet\s+)?have\s+(?:a\s+|any\s+)?)\s*(?:(?:public|native|separate|own|its\s+own|tradable|liquid)\s+){0,3}token\b/gi,
    toFact: (m, today) => {
      const entity = cleanEntity(m[1]);
      if (!entity) return null;
      return {
        topic: `${entity} tokenisation`,
        fact: `${entity} has no token (architectural — re-confirm before pricing or valuing as a tokenised asset).`,
        entities: [entity],
        source: "disambiguation-extractor:no-token",
        confidence: "verified",
        date: today,
      };
    },
  },

  // "X is not tokenised" / "X is not tokenized"
  {
    tag: "not-tokenised",
    re: /\b([A-Z][\w.-]{1,40}(?:\s+[A-Z][\w.-]{1,40}){0,3})\s+is\s+not\s+tokeni[sz]ed\b/gi,
    toFact: (m, today) => {
      const entity = cleanEntity(m[1]);
      if (!entity) return null;
      return {
        topic: `${entity} tokenisation`,
        fact: `${entity} is not tokenised — has no on-chain token representation.`,
        entities: [entity],
        source: "disambiguation-extractor:not-tokenised",
        confidence: "verified",
        date: today,
      };
    },
  },

  // "The X ticker on Y is an (entirely) unrelated token"
  // "The X token on Y is unrelated to Z"
  // The "on PLATFORM" qualifier optionally carries a parenthetical
  // (e.g. "on CoinGecko ($0.041, $4.2M FDV)") which sits between the
  // platform name and "is" — match it with an optional non-greedy
  // bracket gobble.
  {
    tag: "ticker-collision",
    re: /\b(?:the\s+)?["']?([A-Z][\w.-]{1,20})["']?\s+(?:ticker|token)(?:\s+on\s+\w+(?:\s*\([^)]*\))?)?\s+is\s+(?:an?\s+)?(?:entirely\s+|completely\s+)?unrelated(?:\s+token)?(?:\s+to\s+([\w][\w\s.-]{0,40}))?/gi,
    toFact: (m, today) => {
      const ticker = cleanEntity(m[1]);
      const otherEntity = cleanEntity(m[2] || "");
      if (!ticker) return null;
      const entities = otherEntity ? [ticker, otherEntity] : [ticker];
      const topicSuffix = otherEntity ? ` (vs ${otherEntity})` : "";
      const factSuffix = otherEntity ? ` Specifically NOT the same as ${otherEntity}.` : "";
      return {
        topic: `${ticker} ticker collision${topicSuffix}`,
        fact: `The "${ticker}" ticker on CoinGecko / other registries is an unrelated token.${factSuffix} Do not use its price/mcap as a proxy.`,
        entities,
        source: "disambiguation-extractor:ticker-collision",
        confidence: "verified",
        date: today,
      };
    },
  },

  // "Don't confuse X with Y"
  {
    tag: "dont-confuse",
    re: /\b(?:don'?t|do\s+not)\s+confuse\s+([\w][\w\s.-]{1,40})\s+(?:with|and)\s+([\w][\w\s.-]{1,40}?)(?:[.\n,;]|\s+(?:because|since|as|—|-))/gi,
    toFact: (m, today) => {
      const a = cleanEntity(m[1]);
      const b = cleanEntity(m[2]);
      if (!a || !b || a.toLowerCase() === b.toLowerCase()) return null;
      return {
        topic: `${a} vs ${b}`,
        fact: `${a} and ${b} are distinct — do not confuse them. Verify which is meant before using either as a data source.`,
        entities: [a, b],
        source: "disambiguation-extractor:dont-confuse",
        confidence: "verified",
        date: today,
      };
    },
  },
];

/* ──────────────────────── Public API ──────────────────────── */

/** Scan assistant prose for disambiguation/architectural facts and
 *  return them as synthetic brain-fact entries. Dedupes by topic so
 *  multiple matches of the same disambiguation produce one fact. */
export function extractDisambiguationFacts(text: string): ExtractedDisambiguationFact[] {
  if (!text) return [];

  // Strip artifact code-fence bodies so we don't pull patterns out of
  // chart/table JSON. Disambiguation prose appears in the response body
  // proper, not inside artifact data.
  const prose = text.replace(/```artifact:\w+\s*\n[\s\S]*?```/g, " ");

  const today = new Date().toISOString().slice(0, 10);
  const found: ExtractedDisambiguationFact[] = [];
  const seenTopics = new Set<string>();

  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(prose)) !== null) {
      const f = p.toFact(m, today);
      if (!f) continue;
      const key = f.topic.toLowerCase();
      if (seenTopics.has(key)) continue;
      seenTopics.add(key);
      found.push(f);
    }
  }

  return found;
}
