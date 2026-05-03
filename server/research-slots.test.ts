// Concurrency policy tests for the research SSE handler. The slot
// counters are module-level state, so each test gets a fresh import.
//
// What we're protecting against:
//   - per-user cap allowing > MAX_PER_USER_RESEARCH (one user
//     monopolising the global pool)
//   - global cap allowing > MAX_GLOBAL_RESEARCH (uncapped Anthropic
//     spend across the whole task)
//   - release going negative (off-by-one on a leak)
//   - cross-user pollution (user A's release decrementing user B)
import { describe, it, expect, vi } from "vitest";

interface SlotsModule {
  MAX_GLOBAL_RESEARCH: number;
  MAX_PER_USER_RESEARCH: number;
  tryAcquireResearchSlot: (userId: string) => boolean;
  releaseResearchSlot: (userId: string) => void;
  getResearchInflight: () => { global: number; perUser: Record<string, number> };
}

async function freshSlots(env: Record<string, string> = {}): Promise<SlotsModule> {
  vi.resetModules();
  const oldEnv: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    oldEnv[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    return await import("./research-slots");
  } finally {
    for (const [k, v] of Object.entries(oldEnv)) {
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe("research-slots", () => {
  describe("tryAcquireResearchSlot", () => {
    it("succeeds when nothing is in flight", async () => {
      const s = await freshSlots();
      expect(s.tryAcquireResearchSlot("alice")).toBe(true);
      expect(s.getResearchInflight()).toEqual({
        global: 1,
        perUser: { alice: 1 },
      });
    });

    it("respects MAX_PER_USER_RESEARCH and refuses the user's next acquire", async () => {
      const s = await freshSlots({ MAX_PER_USER_RESEARCH: "3" });
      expect(s.MAX_PER_USER_RESEARCH).toBe(3);
      expect(s.tryAcquireResearchSlot("alice")).toBe(true);
      expect(s.tryAcquireResearchSlot("alice")).toBe(true);
      expect(s.tryAcquireResearchSlot("alice")).toBe(true);
      expect(s.tryAcquireResearchSlot("alice")).toBe(false);
      expect(s.getResearchInflight().perUser.alice).toBe(3);
      expect(s.getResearchInflight().global).toBe(3);
    });

    it("respects MAX_GLOBAL_RESEARCH across users", async () => {
      const s = await freshSlots({
        MAX_GLOBAL_RESEARCH: "3",
        MAX_PER_USER_RESEARCH: "10", // ensure global, not per-user, is the bottleneck
      });
      expect(s.tryAcquireResearchSlot("alice")).toBe(true);
      expect(s.tryAcquireResearchSlot("bob")).toBe(true);
      expect(s.tryAcquireResearchSlot("carol")).toBe(true);
      // 4th caller (any user) is blocked.
      expect(s.tryAcquireResearchSlot("dave")).toBe(false);
      expect(s.tryAcquireResearchSlot("alice")).toBe(false);
    });

    it("does not pollute one user's count when another user hits the per-user cap", async () => {
      const s = await freshSlots({ MAX_PER_USER_RESEARCH: "2" });
      expect(s.tryAcquireResearchSlot("alice")).toBe(true);
      expect(s.tryAcquireResearchSlot("alice")).toBe(true);
      expect(s.tryAcquireResearchSlot("alice")).toBe(false); // alice capped
      // bob should still go through.
      expect(s.tryAcquireResearchSlot("bob")).toBe(true);
      expect(s.getResearchInflight().perUser).toEqual({ alice: 2, bob: 1 });
    });
  });

  describe("releaseResearchSlot", () => {
    it("decrements global + per-user counts", async () => {
      const s = await freshSlots();
      s.tryAcquireResearchSlot("alice");
      s.tryAcquireResearchSlot("alice");
      expect(s.getResearchInflight()).toEqual({ global: 2, perUser: { alice: 2 } });
      s.releaseResearchSlot("alice");
      expect(s.getResearchInflight()).toEqual({ global: 1, perUser: { alice: 1 } });
    });

    it("removes the user entry once their count hits zero", async () => {
      const s = await freshSlots();
      s.tryAcquireResearchSlot("alice");
      s.releaseResearchSlot("alice");
      expect(s.getResearchInflight().perUser.alice).toBeUndefined();
    });

    it("never lets the global counter go negative on stray releases", async () => {
      const s = await freshSlots();
      s.releaseResearchSlot("ghost");
      s.releaseResearchSlot("ghost");
      expect(s.getResearchInflight().global).toBe(0);
    });

    it("after releasing a capped user, that user can acquire again", async () => {
      const s = await freshSlots({ MAX_PER_USER_RESEARCH: "1" });
      expect(s.tryAcquireResearchSlot("alice")).toBe(true);
      expect(s.tryAcquireResearchSlot("alice")).toBe(false);
      s.releaseResearchSlot("alice");
      expect(s.tryAcquireResearchSlot("alice")).toBe(true);
    });

    it("releasing user A doesn't affect user B's count", async () => {
      const s = await freshSlots();
      s.tryAcquireResearchSlot("alice");
      s.tryAcquireResearchSlot("bob");
      s.releaseResearchSlot("alice");
      expect(s.getResearchInflight().perUser).toEqual({ bob: 1 });
      expect(s.getResearchInflight().global).toBe(1);
    });
  });
});
