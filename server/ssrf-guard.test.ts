// Coverage for the SSRF guard. We test the address classifier directly
// (pure function, no DNS) and the URL-level guard with mocked DNS for
// hostname cases. The agent's web_fetch tool calls rejectIfPrivateAddress
// before issuing the HTTP request — if these tests regress, the agent
// could be tricked into fetching AWS metadata, RFC 1918 hosts, or
// localhost services.
import { describe, it, expect, vi } from "vitest";

import {
  checkAddressRestriction,
  rejectIfPrivateAddress,
  SSRFError,
} from "./ssrf-guard";

describe("checkAddressRestriction — direct IPv4 classification", () => {
  // AWS metadata service — the headline attack
  it("blocks AWS metadata 169.254.169.254", () => {
    expect(checkAddressRestriction("169.254.169.254")).toMatch(/link-local/);
  });

  it("blocks 169.254.0.0/16 broadly", () => {
    expect(checkAddressRestriction("169.254.0.1")).toMatch(/link-local/);
    expect(checkAddressRestriction("169.254.255.255")).toMatch(/link-local/);
  });

  // Loopback
  it("blocks IPv4 loopback 127.0.0.1", () => {
    expect(checkAddressRestriction("127.0.0.1")).toMatch(/loopback/);
  });

  it("blocks any 127.x.y.z (entire /8 is loopback)", () => {
    expect(checkAddressRestriction("127.0.5.1")).toMatch(/loopback/);
    expect(checkAddressRestriction("127.255.255.1")).toMatch(/loopback/);
  });

  // RFC 1918 private
  it("blocks 10.0.0.0/8", () => {
    expect(checkAddressRestriction("10.0.0.1")).toMatch(/RFC 1918/);
    expect(checkAddressRestriction("10.255.255.255")).toMatch(/RFC 1918/);
  });

  it("blocks 192.168.0.0/16", () => {
    expect(checkAddressRestriction("192.168.1.1")).toMatch(/RFC 1918/);
  });

  it("blocks 172.16.0.0/12 (the tricky one — only 172.16-172.31)", () => {
    expect(checkAddressRestriction("172.16.0.1")).toMatch(/RFC 1918/);
    expect(checkAddressRestriction("172.31.255.255")).toMatch(/RFC 1918/);
  });

  it("does NOT block 172.32.x.x and 172.15.x.x (outside the /12)", () => {
    // 172.32+ is public; 172.0-172.15 is public
    expect(checkAddressRestriction("172.32.0.1")).toBeNull();
    expect(checkAddressRestriction("172.15.0.1")).toBeNull();
  });

  // CGNAT
  it("blocks CGNAT 100.64.0.0/10", () => {
    expect(checkAddressRestriction("100.64.0.1")).toMatch(/CGNAT/);
    expect(checkAddressRestriction("100.127.255.255")).toMatch(/CGNAT/);
  });

  it("does NOT block 100.0-63 or 100.128+ (outside CGNAT range)", () => {
    expect(checkAddressRestriction("100.63.0.1")).toBeNull();
    expect(checkAddressRestriction("100.128.0.1")).toBeNull();
  });

  // Unspecified + multicast + reserved
  it("blocks 0.0.0.0/8 (unspecified)", () => {
    expect(checkAddressRestriction("0.0.0.0")).toMatch(/unspecified/);
  });
  it("blocks multicast 224.0.0.0/4", () => {
    expect(checkAddressRestriction("224.0.0.1")).toMatch(/multicast/);
  });
  it("blocks reserved 240.0.0.0/4", () => {
    expect(checkAddressRestriction("240.0.0.1")).toMatch(/reserved/);
  });

  // Public — should NOT be blocked
  it("allows public IPv4 like 8.8.8.8 (Google DNS)", () => {
    expect(checkAddressRestriction("8.8.8.8")).toBeNull();
  });
  it("allows public IPv4 like 1.1.1.1 (Cloudflare DNS)", () => {
    expect(checkAddressRestriction("1.1.1.1")).toBeNull();
  });
  it("allows public IPv4 like 13.32.0.1 (AWS CloudFront edge — public)", () => {
    expect(checkAddressRestriction("13.32.0.1")).toBeNull();
  });
});

describe("checkAddressRestriction — IPv6 classification", () => {
  it("blocks IPv6 loopback ::1", () => {
    expect(checkAddressRestriction("::1")).toMatch(/loopback/);
    expect(checkAddressRestriction("0:0:0:0:0:0:0:1")).toMatch(/loopback/);
  });

  it("blocks IPv6 unspecified ::", () => {
    expect(checkAddressRestriction("::")).toMatch(/unspecified/);
  });

  it("blocks IPv6 link-local fe80::", () => {
    expect(checkAddressRestriction("fe80::1")).toMatch(/link-local/);
    expect(checkAddressRestriction("fea0::1")).toMatch(/link-local/);
  });

  it("blocks IPv6 unique-local fc00::", () => {
    expect(checkAddressRestriction("fc00::1")).toMatch(/unique local/);
    expect(checkAddressRestriction("fd00::1")).toMatch(/unique local/);
  });

  it("blocks IPv4-mapped IPv6 ::ffff:169.254.169.254 (the AWS metadata bypass attempt)", () => {
    expect(checkAddressRestriction("::ffff:169.254.169.254")).toMatch(/link-local/);
  });

  it("blocks IPv4-mapped IPv6 ::ffff:127.0.0.1", () => {
    expect(checkAddressRestriction("::ffff:127.0.0.1")).toMatch(/loopback/);
  });

  it("allows public IPv6 like 2001:4860:4860::8888 (Google DNS)", () => {
    expect(checkAddressRestriction("2001:4860:4860::8888")).toBeNull();
  });
});

describe("rejectIfPrivateAddress — URL-level guard with DNS", () => {
  it("rejects file:// scheme", async () => {
    await expect(rejectIfPrivateAddress("file:///etc/passwd")).rejects.toThrow(SSRFError);
    await expect(rejectIfPrivateAddress("file:///etc/passwd")).rejects.toThrow(/Scheme/);
  });

  it("rejects gopher:// scheme (classic SSRF vector)", async () => {
    await expect(rejectIfPrivateAddress("gopher://internal/")).rejects.toThrow(/Scheme/);
  });

  it("rejects ftp:// scheme", async () => {
    await expect(rejectIfPrivateAddress("ftp://internal/")).rejects.toThrow(/Scheme/);
  });

  it("rejects data: scheme", async () => {
    await expect(rejectIfPrivateAddress("data:text/plain,hello")).rejects.toThrow(/Scheme/);
  });

  it("rejects javascript: scheme", async () => {
    await expect(rejectIfPrivateAddress("javascript:alert(1)")).rejects.toThrow(/Scheme/);
  });

  it("rejects localhost without DNS lookup", async () => {
    await expect(rejectIfPrivateAddress("http://localhost:5000/admin")).rejects.toThrow(/loopback alias/);
  });

  it("rejects *.localhost variants", async () => {
    await expect(rejectIfPrivateAddress("http://admin.localhost/")).rejects.toThrow(/loopback alias/);
  });

  it("rejects metadata.google.internal (GCP metadata)", async () => {
    await expect(rejectIfPrivateAddress("http://metadata.google.internal/")).rejects.toThrow(/cloud metadata/);
  });

  it("rejects literal AWS metadata IP without DNS lookup", async () => {
    await expect(rejectIfPrivateAddress("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(/link-local/);
  });

  it("rejects literal 127.0.0.1 without DNS", async () => {
    await expect(rejectIfPrivateAddress("http://127.0.0.1/internal")).rejects.toThrow(/loopback/);
  });

  it("rejects literal RFC 1918 IPs without DNS", async () => {
    await expect(rejectIfPrivateAddress("http://10.0.0.5/")).rejects.toThrow(/RFC 1918/);
    await expect(rejectIfPrivateAddress("http://192.168.1.1/")).rejects.toThrow(/RFC 1918/);
  });

  it("rejects IPv6 loopback URL", async () => {
    await expect(rejectIfPrivateAddress("http://[::1]/")).rejects.toThrow(/loopback/);
  });

  it("rejects DNS-rebinding hostname that resolves to private IP", async () => {
    // Mock node:dns/promises.lookup to return 127.0.0.1 for "attacker.com".
    // Use vi.doMock (NOT vi.mock) — vi.mock is hoisted to the top of the
    // file, but we want module-scoped one-off mocking here so we can
    // re-import a fresh ssrf-guard module with the mocked DNS resolver.
    vi.resetModules();
    vi.doMock("node:dns/promises", () => ({
      lookup: async (host: string, _opts: any) => {
        if (host === "attacker.com") {
          return [{ address: "127.0.0.1", family: 4 }];
        }
        if (host === "real-public.com") {
          return [{ address: "8.8.8.8", family: 4 }];
        }
        throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
      },
    }));

    const { rejectIfPrivateAddress: reb } = await import("./ssrf-guard");
    await expect(reb("http://attacker.com/")).rejects.toThrow(/possible DNS rebinding/);

    vi.doUnmock("node:dns/promises");
    vi.resetModules();
  });

  it("rejects malformed URLs", async () => {
    await expect(rejectIfPrivateAddress("not-a-url")).rejects.toThrow(/Invalid URL/);
  });
});
