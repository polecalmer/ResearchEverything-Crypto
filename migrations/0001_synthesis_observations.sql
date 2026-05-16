-- 2026-05-16: synthesis_observations table
-- Self-learning substrate for memo OUTPUT structure (Phase 1: observation only).
-- Mirrors hermes' data_source_facts accumulation pattern, applied to memo
-- structural patterns rather than tool behavior. Bootstrap from analyst_documents;
-- continuous ingestion from live runtime synthesis. See server/synthesis-observer.ts.
--
-- Phase 3 (separate) will join this table against memo outcome signals
-- (save / download / regenerate / correction) to derive synthesis_discipline
-- rules via correlation — no manual seeding.

CREATE TABLE IF NOT EXISTS synthesis_observations (
  id               varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       text,
  message_id       text,
  user_id          text NOT NULL DEFAULT 'default',
  mode             text,                                       -- deep | focused | chart | quick
  playbook_id      text,
  memo_chars       integer NOT NULL DEFAULT 0,
  subject_entities text[] NOT NULL DEFAULT '{}'::text[],
  patterns         text[] NOT NULL DEFAULT '{}'::text[],
  patterns_detail  jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance       text NOT NULL,                              -- 'sessions:runtime' | 'analyst-corpus:bootstrap' | 'manual'
  provenance_ref   text,                                       -- session_id or analyst_documents.id
  observed_at      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS synthesis_observations_patterns_idx ON synthesis_observations USING gin (patterns);
CREATE INDEX IF NOT EXISTS synthesis_observations_provenance_idx ON synthesis_observations (provenance);
CREATE INDEX IF NOT EXISTS synthesis_observations_session_idx ON synthesis_observations (session_id);
CREATE INDEX IF NOT EXISTS synthesis_observations_observed_at_idx ON synthesis_observations (observed_at);

COMMENT ON TABLE synthesis_observations IS
  'Self-learning substrate: every memo synthesis writes one row tagged with detected structural patterns. Phase 3 correlates these against outcome signals to derive synthesis_discipline rules.';
