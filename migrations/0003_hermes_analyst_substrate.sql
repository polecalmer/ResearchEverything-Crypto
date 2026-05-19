-- 2026-05-17: hermes analyst substrate parity.
--
-- Ports the 5 analyst tables sessions was missing from hermes' dune-brain
-- (which itself says "Mirrors the existing ResearchEverything-Crypto
-- platform's brain layer" — they're the same blueprint; sessions just
-- never built out the perspective layers).
--
-- Schema parity tables (referenced by extractor scripts):
--   analysts                — master table of analyst identities (slug-keyed)
--   analyst_raw_posts       — platform-tagged posts (hrc/x/blockworks/...)
--   analyst_questions       — investigation patterns (4-7 question types)
--   analyst_signals         — default data sources / metrics they reach for
--   analyst_style_patterns  — output structure conventions (opening/closing/caveat)
--
-- Sessions' existing analyst_frameworks table already covers framework
-- extraction. The extractor script populates it via the same hybrid
-- versioning approach hermes uses (versions JSONB + version_count).
--
-- Sessions' existing analyst_documents + analyst_chunks tables are NOT
-- modified — they belong to the file-based ingestion path. The new
-- analyst_raw_posts is for API-pulled posts (hyperliquidr.xyz, etc.) which
-- have platform-native post_ids and are upserted by (platform, post_id).
--
-- Hybrid retrieval on every table: pgvector(1024) HNSW + GIN tsvector +
-- RRF — same shape as the rest of the brain.

CREATE EXTENSION IF NOT EXISTS vector;

-- ── analysts ────────────────────────────────────────────────────────────
-- Master identity table. All perspective tables FK back to here.
CREATE TABLE IF NOT EXISTS analysts (
  slug            text PRIMARY KEY,
  display_name    text NOT NULL,
  bio             text,
  twitter_handle  text,                          -- '@handle' (no URL prefix)
  twitter_url     text,
  website         text,
  telegram        text,
  image_url       text,
  source          text NOT NULL,                 -- 'hrc' | 'manual' | etc. — where we discovered them
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analysts_twitter_handle_idx ON analysts (twitter_handle);
CREATE INDEX IF NOT EXISTS analysts_source_idx ON analysts (source);

-- ── analyst_raw_posts ───────────────────────────────────────────────────
-- Platform-aware raw landing. Idempotent by (platform, post_id).
CREATE TABLE IF NOT EXISTS analyst_raw_posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analyst_slug    text NOT NULL REFERENCES analysts(slug) ON DELETE CASCADE,

  -- platform + native id
  platform        text NOT NULL,                 -- 'hrc' | 'x' | 'blockworks' | 'substack' | 'mirror' | etc.
  post_id         text NOT NULL,                 -- platform-native id (slug, tweet id, ...)
  url             text,

  -- content
  title           text,
  excerpt         text,
  category        text,                          -- platform-specific (e.g. HRC: 'hyperliquid' | 'ecosystem')
  content_html    text,                          -- raw HTML preserved for re-processing
  content_md      text,                          -- markdown rendition for embeddings + LLM input
  word_count      integer,                       -- on content_md
  content_type    text,                          -- 'post' | 'newsletter' | 'tweet' | 'thread' | 'reply'

  -- temporal
  published_at    timestamptz,
  fetched_at      timestamptz NOT NULL DEFAULT now(),

  -- platform-specific extras
  metadata        jsonb DEFAULT '{}'::jsonb,

  CONSTRAINT analyst_raw_posts_platform_post_id_key UNIQUE (platform, post_id)
);

CREATE INDEX IF NOT EXISTS analyst_raw_posts_analyst_idx     ON analyst_raw_posts (analyst_slug);
CREATE INDEX IF NOT EXISTS analyst_raw_posts_platform_idx    ON analyst_raw_posts (platform);
CREATE INDEX IF NOT EXISTS analyst_raw_posts_published_at_idx ON analyst_raw_posts (published_at DESC);

-- ── analyst_questions ───────────────────────────────────────────────────
-- LAYER 1 — investigation patterns. Most generalizable layer; transfers
-- across topics the analyst hasn't written about yet.
CREATE TABLE IF NOT EXISTS analyst_questions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analyst_slug    text NOT NULL REFERENCES analysts(slug) ON DELETE CASCADE,

  question_text   text NOT NULL,                 -- canonical question, generalized form
  question_topic  text,                          -- 'hyperliquid' | 'lending' | 'tokenomics' | 'market_microstructure' | etc.
  question_type   text,                          -- 'investigation_starter' | 'risk_check' | 'thesis_validation'
                                                 -- | 'mechanism_check' | 'unit_economics' | 'comparative'
  evidence_quote  text,                          -- corpus snippet that triggered this
  source_post_ids text[],                        -- which post slugs/ids this came from

  embedding       vector(1024),
  content_tsv     tsvector GENERATED ALWAYS AS (
                    to_tsvector('english',
                      coalesce(question_text,'')  || ' ' ||
                      coalesce(question_topic,'') || ' ' ||
                      coalesce(question_type,''))
                  ) STORED,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analyst_questions_analyst_idx ON analyst_questions (analyst_slug);
CREATE INDEX IF NOT EXISTS analyst_questions_topic_idx   ON analyst_questions (question_topic);
CREATE INDEX IF NOT EXISTS analyst_questions_type_idx    ON analyst_questions (question_type);
CREATE INDEX IF NOT EXISTS analyst_questions_embedding_idx
  ON analyst_questions USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS analyst_questions_tsv_idx
  ON analyst_questions USING gin (content_tsv);

-- ── analyst_signals ─────────────────────────────────────────────────────
-- LAYER 3 — default data sources, dashboards, metrics.
-- "When this analyst asks about X, they reach for Y."
CREATE TABLE IF NOT EXISTS analyst_signals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analyst_slug    text NOT NULL REFERENCES analysts(slug) ON DELETE CASCADE,

  signal_name     text NOT NULL,                 -- 'mintedToTreasury events' | 'funding rate skew' | etc.
  signal_kind     text,                          -- 'on_chain_event' | 'derived_metric' | 'dashboard' | 'data_source' | 'rule_of_thumb'
  source_ref      text,                          -- table/dashboard/dataset reference if specific
  use_case        text,                          -- when they reach for this
  source_post_ids text[],

  embedding       vector(1024),
  content_tsv     tsvector GENERATED ALWAYS AS (
                    to_tsvector('english',
                      coalesce(signal_name,'') || ' ' ||
                      coalesce(signal_kind,'') || ' ' ||
                      coalesce(use_case,''))
                  ) STORED,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (analyst_slug, signal_name)
);

CREATE INDEX IF NOT EXISTS analyst_signals_analyst_idx ON analyst_signals (analyst_slug);
CREATE INDEX IF NOT EXISTS analyst_signals_kind_idx    ON analyst_signals (signal_kind);
CREATE INDEX IF NOT EXISTS analyst_signals_embedding_idx
  ON analyst_signals USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS analyst_signals_tsv_idx
  ON analyst_signals USING gin (content_tsv);

-- ── analyst_style_patterns ──────────────────────────────────────────────
-- LAYER 4 — output structure conventions ("how they write").
-- Pulled into the synthesis prompt only when the user is composing a
-- memo-style output and a specific analyst style was requested.
CREATE TABLE IF NOT EXISTS analyst_style_patterns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analyst_slug    text NOT NULL REFERENCES analysts(slug) ON DELETE CASCADE,

  pattern_name    text NOT NULL,                 -- 'methodology disclosure block' | 'lead with falsifiable claim'
  pattern_kind    text,                          -- 'opening' | 'closing' | 'transition' | 'caveat' | 'structure'
  description     text,
  example_quote   text,
  source_post_ids text[],

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (analyst_slug, pattern_name)
);

CREATE INDEX IF NOT EXISTS analyst_style_patterns_analyst_idx ON analyst_style_patterns (analyst_slug);
CREATE INDEX IF NOT EXISTS analyst_style_patterns_kind_idx    ON analyst_style_patterns (pattern_kind);

-- ── shared updated_at trigger (idempotent — only created if missing) ────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at') THEN
    CREATE FUNCTION update_updated_at() RETURNS TRIGGER AS $f$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $f$ LANGUAGE plpgsql;
  END IF;
END $$;

DROP TRIGGER IF EXISTS analysts_updated_at              ON analysts;
DROP TRIGGER IF EXISTS analyst_raw_posts_updated_at     ON analyst_raw_posts;
DROP TRIGGER IF EXISTS analyst_questions_updated_at     ON analyst_questions;
DROP TRIGGER IF EXISTS analyst_signals_updated_at       ON analyst_signals;
DROP TRIGGER IF EXISTS analyst_style_patterns_updated_at ON analyst_style_patterns;

CREATE TRIGGER analysts_updated_at              BEFORE UPDATE ON analysts              FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER analyst_raw_posts_updated_at     BEFORE UPDATE ON analyst_raw_posts     FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER analyst_questions_updated_at     BEFORE UPDATE ON analyst_questions     FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER analyst_signals_updated_at       BEFORE UPDATE ON analyst_signals       FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER analyst_style_patterns_updated_at BEFORE UPDATE ON analyst_style_patterns FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE analysts                IS 'Master identity table for analysts. Slug-keyed; all perspective tables FK here. Mirrors hermes/dune-brain analysts.';
COMMENT ON TABLE analyst_raw_posts       IS 'Platform-aware raw landing for analyst posts (HRC/X/Substack/etc.). Idempotent on (platform, post_id). Feeds the 4 extractors.';
COMMENT ON TABLE analyst_questions       IS 'LAYER 1 — investigation patterns. Most generalizable; transfers across new topics. Populated by extract-analyst-perspectives.ts.';
COMMENT ON TABLE analyst_signals         IS 'LAYER 3 — default data sources / dashboards / metrics each analyst reaches for. Joined at consult-time to enrich brain context.';
COMMENT ON TABLE analyst_style_patterns  IS 'LAYER 4 — output structure conventions. Conditioned on memo-mode + analyst persona only — not injected into every prompt.';
