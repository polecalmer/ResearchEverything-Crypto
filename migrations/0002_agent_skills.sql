-- 2026-05-17: agent_skills table — procedural skill packs the agent
-- consults at synthesis time. Mirrors the hermes "skills" pattern
-- (server/.hermes/skills/ → SKILL.md procedure docs) ported into the
-- sessions brain as retrievable rows.
--
-- Used by: query_agent_skills(query, limit) tool — hybrid vector + BM25
-- retrieval ranked by relevance. Returns the skill BODY (procedure prose)
-- which the agent then follows for that specific question shape.
--
-- Bootstrap: script/bootstrap-agent-skills.ts (one-shot import from
-- /Users/sessions/.hermes/skills/{data-science,research}/**/SKILL.md
-- with Voyage embeddings + tsvector for hybrid retrieval).
--
-- Shape echoes analyst_frameworks (97 rows, same brain layer) so retrieval
-- code reuses the same hybrid pattern.

CREATE TABLE IF NOT EXISTS agent_skills (
  id               varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text NOT NULL UNIQUE,                  -- e.g. "crypto-protocol-valuation"
  name             text NOT NULL,                         -- e.g. "Crypto Protocol Valuation"
  category         text NOT NULL,                         -- "data-science" | "research"
  description      text NOT NULL,                         -- short tagline pulled from skill front-matter
  body             text NOT NULL,                         -- the SKILL.md prose (the procedure itself)
  source_path      text,                                  -- origin: relative path under hermes/skills/
  embedding        vector(1024) NOT NULL,                 -- voyage-3.5 over `name || ' ' || description || ' ' || body`
  content_tsv      tsvector GENERATED ALWAYS AS (
                      to_tsvector('english',
                        coalesce(name, '') || ' ' ||
                        coalesce(description, '') || ' ' ||
                        coalesce(body, ''))
                    ) STORED,
  created_at       timestamp NOT NULL DEFAULT now(),
  updated_at       timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_skills_slug_idx ON agent_skills (slug);
CREATE INDEX IF NOT EXISTS agent_skills_category_idx ON agent_skills (category);
CREATE INDEX IF NOT EXISTS agent_skills_embedding_idx
  ON agent_skills USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS agent_skills_tsv_idx
  ON agent_skills USING gin (content_tsv);

COMMENT ON TABLE agent_skills IS
  'Procedural skill packs (port of hermes SKILL.md docs). Retrieved via query_agent_skills tool at synthesis time. Hybrid vector + BM25 search returns the skill body the agent then follows.';
