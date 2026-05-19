/**
 * CreditsPill — small header indicator showing the user's remaining
 * turn balance + a link to /credits when low or empty.
 *
 * Beta semantics: every user gets 20 free turns at signup. After 0 the
 * server returns 402 on POST /messages and the chat input gates with
 * the purchase modal. This pill is the always-visible reminder.
 */

import { Link } from "wouter";
import { Coins, AlertCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export function CreditsPill() {
  const { user } = useAuth();
  if (!user || (user as any).__betaFull) return null;

  const credits = (user as any).credits ?? 0;
  // Admin users get 999999 — render as "∞" to avoid a giant number.
  const isAdmin = credits >= 999_000;
  const display = isAdmin ? "∞" : String(credits);

  // Color states: red < 3, amber < 10, neutral otherwise.
  let toneClass = "bg-zinc-800/80 text-zinc-200 hover:bg-zinc-700/80";
  if (!isAdmin && credits === 0) {
    toneClass = "bg-rose-900/40 text-rose-200 hover:bg-rose-900/60 border border-rose-700/40";
  } else if (!isAdmin && credits < 3) {
    toneClass = "bg-rose-900/30 text-rose-300 hover:bg-rose-900/40";
  } else if (!isAdmin && credits < 10) {
    toneClass = "bg-amber-900/30 text-amber-200 hover:bg-amber-900/40";
  }

  return (
    <Link
      href="/credits"
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${toneClass}`}
      data-testid="credits-pill"
      title={
        isAdmin
          ? "Admin — unlimited turns"
          : credits === 0
            ? "No turns left — click to purchase more"
            : `${credits} ${credits === 1 ? "turn" : "turns"} remaining`
      }
    >
      {!isAdmin && credits === 0 ? (
        <AlertCircle className="h-3.5 w-3.5" />
      ) : (
        <Coins className="h-3.5 w-3.5" />
      )}
      <span>{display}</span>
      <span className="hidden sm:inline opacity-70">
        {isAdmin ? "" : credits === 1 ? "turn" : "turns"}
      </span>
    </Link>
  );
}
