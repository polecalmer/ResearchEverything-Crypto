// Per-user + global concurrency caps for the research SSE handler.
// Extracted from server/routes/research-routes.ts so the policy can be
// unit-tested in isolation.
//
// MODULE-LEVEL STATE NOTE: counters live in this module's closure, so
// they're per-process. With multiple ECS tasks behind an ALB the global
// cap is enforced PER TASK, not across the fleet. Once we go multi-
// instance, move this state to Redis (per-user TTL'd counter +
// distributed semaphore for the global cap).

export const MAX_GLOBAL_RESEARCH = Number(process.env.MAX_GLOBAL_RESEARCH || 12);
export const MAX_PER_USER_RESEARCH = Number(process.env.MAX_PER_USER_RESEARCH || 6);

const inflightPerUser = new Map<string, number>();
let inflightGlobal = 0;

export function tryAcquireResearchSlot(userId: string): boolean {
  const userCount = inflightPerUser.get(userId) || 0;
  if (inflightGlobal >= MAX_GLOBAL_RESEARCH) return false;
  if (userCount >= MAX_PER_USER_RESEARCH) return false;
  inflightGlobal++;
  inflightPerUser.set(userId, userCount + 1);
  return true;
}

export function releaseResearchSlot(userId: string): void {
  inflightGlobal = Math.max(0, inflightGlobal - 1);
  const userCount = (inflightPerUser.get(userId) || 1) - 1;
  if (userCount <= 0) inflightPerUser.delete(userId);
  else inflightPerUser.set(userId, userCount);
}

export function getResearchInflight(): {
  global: number;
  perUser: Record<string, number>;
} {
  return {
    global: inflightGlobal,
    perUser: Object.fromEntries(inflightPerUser),
  };
}
