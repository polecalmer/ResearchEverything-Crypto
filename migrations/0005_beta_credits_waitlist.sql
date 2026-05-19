-- 2026-05-19: Beta credits + waitlist.
--
-- Beta semantics: 20 total users, each granted 20 free credits at
-- signup. After credits = 0, users buy more via Stripe at $7/turn or
-- $70 for 10. When the 20-user cap is hit, new signups land on the
-- waitlist instead.
--
-- 1. Change the `users.credits` default from 0 to 20 so every new
--    signup gets the free tier automatically. Existing users keep
--    whatever balance they have today — we backfill separately when
--    we cut over to the beta cohort.
--
-- 2. New `waitlist` table for >20 signups. Captures email/wallet and
--    a free-form note so admin can decide who to admit next. Inviter
--    flips `invited_at` when they admit a user.

ALTER TABLE users
  ALTER COLUMN credits SET DEFAULT 20;

CREATE TABLE IF NOT EXISTS waitlist (
  id          varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text,
  wallet_address text,
  privy_id    text,
  joined_at   timestamptz NOT NULL DEFAULT now(),
  invited_at  timestamptz,
  notes       text,
  -- One of (email, wallet_address, privy_id) MUST be set so we have a
  -- way to invite the person. Enforced in app code, not DB.
  CONSTRAINT waitlist_contact_present
    CHECK (email IS NOT NULL OR wallet_address IS NOT NULL OR privy_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist (lower(email));
CREATE INDEX IF NOT EXISTS idx_waitlist_wallet ON waitlist (lower(wallet_address));
CREATE INDEX IF NOT EXISTS idx_waitlist_privy ON waitlist (privy_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_joined ON waitlist (joined_at);

-- Cohort-grant ledger so we can audit who got the free 20 + when, and
-- prevent a Privy account reset from re-granting the freebie. One row
-- per beta-grant event keyed by user_id.
CREATE TABLE IF NOT EXISTS beta_grants (
  user_id     varchar PRIMARY KEY,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  amount      integer NOT NULL,
  reason      text NOT NULL DEFAULT 'beta_free_tier'
);
