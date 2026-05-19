-- 2026-05-17: llm_cost_events — per-call cost ledger.
--
-- Every openrouter.request that emits a log line ALSO writes a row
-- here, so we have a queryable record of LLM spend per conversation /
-- per user / per call type. Solves the "can't reconstruct cost from
-- rotated server logs" gap surfaced when reconciling sessions'
-- voucher_estimate vs OpenRouter dashboard ($65 est vs $36.30 actual).
--
-- Two cost fields:
--   cost_estimate — sessions' internal voucher_estimate (token×rate)
--   cost_actual   — reconciled from OpenRouter receipts (populated by
--                   a nightly reconciliation job; null until then)
--
-- The conversation_id + message_id are NULLABLE because not every
-- LLM call belongs to a user-facing conversation (e.g. classifier,
-- planner, extraction scripts, smoke tests). When unset, the call
-- still tracks against user_id + created_at for daily roll-ups.

CREATE TABLE IF NOT EXISTS llm_cost_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Linkage (all nullable — calls outside a conversation still track)
  conversation_id     integer,
  message_id          integer,
  user_id             text,
  request_id          text,                       -- correlates with logger requestId

  -- Call identity
  model               text NOT NULL,              -- "anthropic/claude-opus-4-7" etc
  call_kind           text NOT NULL DEFAULT 'agent_loop',
                                                  -- 'agent_loop' | 'classifier' | 'planner' |
                                                  -- 'synthesis' | 'validator_retry' | 'extraction' |
                                                  -- 'observer' | 'analyst_perspective' | 'wrap_up' |
                                                  -- 'chart_shaper' | 'unknown'
  path                text,                       -- 'native' | 'openai_shape' | 'streaming' | 'direct'

  -- Token accounting
  input_tokens        integer NOT NULL DEFAULT 0,
  output_tokens       integer NOT NULL DEFAULT 0,
  cache_read_tokens   integer NOT NULL DEFAULT 0,
  cache_write_tokens  integer NOT NULL DEFAULT 0,

  -- Cost: estimate (always) + actual (reconciled later from OR receipts)
  cost_estimate       numeric(12, 6) NOT NULL,
  cost_actual         numeric(12, 6),
  cost_source         text NOT NULL DEFAULT 'voucher_estimate',
                                                  -- 'voucher_estimate' | 'receipt' | 'reconciled'

  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Per-conversation cost rollups (the most common query)
CREATE INDEX IF NOT EXISTS llm_cost_events_conv_idx
  ON llm_cost_events (conversation_id, created_at)
  WHERE conversation_id IS NOT NULL;

-- Per-message (when message_id is bound at call time)
CREATE INDEX IF NOT EXISTS llm_cost_events_msg_idx
  ON llm_cost_events (message_id)
  WHERE message_id IS NOT NULL;

-- Daily spend per user (the OpenRouter-dashboard-style query)
CREATE INDEX IF NOT EXISTS llm_cost_events_user_day_idx
  ON llm_cost_events (user_id, created_at)
  WHERE user_id IS NOT NULL;

-- Split by call kind (planner vs synthesis vs validator)
CREATE INDEX IF NOT EXISTS llm_cost_events_kind_idx
  ON llm_cost_events (call_kind, created_at);

COMMENT ON TABLE llm_cost_events IS
  'Per-call LLM cost ledger. Solves the rotated-log gap — every openrouter.request fires a row. Reconcile cost_actual via nightly OR receipts job.';
