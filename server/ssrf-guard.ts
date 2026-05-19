/**
 * SSRF (Server-Side Request Forgery) guard.
 *
 * Blocks outbound fetches to private IP ranges and loopback addresses
 * before they're issued. Defends against:
 *
 *   1. AWS instance metadata leak — http://169.254.169.254/latest/meta-data/iam/
 *      → can expose IAM role credentials with full prod permissions
 *   2. Internal service probing — http://10.0.0.5/admin, http://192.168.1.1/router
 *   3. Local service hits — http://localhost:5000/internal-admin
 *   4. DNS rebinding attacks — domain that resolves to 127.0.0.1
 *      → we resolve hostname ourselves and check the actual IP, not the name
 *   5. Non-http(s) schemes — file://, gopher://, ftp://, data:
 *
 * Threat model: the agent's web_fetch tool takes a URL chosen by the
 * LLM in response to a user prompt. A user could prompt:
 *   "fetch http://169.254.169.254/latest/meta-data/iam/security-credentials/role-name"
 * and exfiltrate the production IAM credentials. This guard refuses.
 *
 * IPv4 + IPv6 coverage:
 *   IPv4 private (RFC 1918):     10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 *   IPv4 loopback:               127.0.0.0/8
 *   IPv4 link-local (AWS meta):  169.254.0.0/16
 *   IPv4 CGNAT:                  100.64.0.0/10
 *   IPv4 unspecified:            0.0.0.0/8
 *   IPv6 loopback:               ::1
 *   IPv6 link-local:             fe80::/10
 *   IPv6 unique local:           fc00::/7
 *   IPv6 mapped IPv4:            ::ffff:0:0/96 (re-check as IPv4)
 */

import { lookup } from "node:dns/promises";
import { isIPv4, isIPv6 } from "node:net";

/** Parse an IPv4 dotted-quad to 4 bytes. Returns null if not v4. */
function ipv4ToBytes(addr: string): number[] | null {
  if (!isIPv4(addr)) return null;
  return addr.split(".").map((p) => Number(p));
}

/** Decide whether an IPv4 address is in a private/loopback/restricted range.
 *  Returns the matching label for the error message, or null if public. */
function ipv4Restriction(addr: string): string | null {
  const b = ipv4ToBytes(addr);
  if (!b) return null;
  const [a, b1, b2, b3] = b;
  if (a === 10) return "10.0.0.0/8 (RFC 1918 private)";
  if (a === 127) return "127.0.0.0/8 (loopback)";
  if (a === 169 && b1 === 254) return "169.254.0.0/16 (link-local — includes AWS metadata)";
  if (a === 172 && b1 >= 16 && b1 <= 31) return "172.16.0.0/12 (RFC 1918 private)";
  if (a === 192 && b1 === 168) return "192.168.0.0/16 (RFC 1918 private)";
  if (a === 100 && b1 >= 64 && b1 <= 127) return "100.64.0.0/10 (CGNAT)";
  if (a === 0) return "0.0.0.0/8 (unspecified)";
  // Multicast + reserved future use — also block (no public service)
  if (a >= 224 && a <= 239) return "224.0.0.0/4 (multicast)";
  if (a >= 240) return "240.0.0.0/4 (reserved)";
  return null;
}

function ipv6Restriction(addr: string): string | null {
  if (!isIPv6(addr)) return null;
  const lower = addr.toLowerCase();
  // ::1 — loopback (compressed forms)
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return "::1 (IPv6 loopback)";
  // :: — unspecified
  if (lower === "::" || lower === "0:0:0:0:0:0:0:0") return ":: (IPv6 unspecified)";
  // ::ffff:X.Y.Z.W — IPv4-mapped (re-check the v4 part)
  const v4MapMatch = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4MapMatch) {
    const v4Restriction = ipv4Restriction(v4MapMatch[1]);
    return v4Restriction ? `IPv4-mapped: ${v4Restriction}` : null;
  }
  // fe80::/10 — link-local
  if (/^fe[89ab]/.test(lower)) return "fe80::/10 (IPv6 link-local)";
  // fc00::/7 — unique local
  if (/^f[cd]/.test(lower)) return "fc00::/7 (IPv6 unique local)";
  return null;
}

/** Check a literal IP string for restriction. Returns the label for
 *  the error message, or null if the IP is public-routable. */
export function checkAddressRestriction(addr: string): string | null {
  return ipv4Restriction(addr) || ipv6Restriction(addr);
}

/**
 * Reject a URL if its scheme, hostname, or resolved IP indicates a
 * private/loopback/restricted target. Throws an SSRFError with a
 * specific message so callers can return it back as a structured tool
 * error (and log for telemetry).
 *
 * This MUST be called before every outbound fetch in user-influenced
 * code paths (web_fetch tool, search-backend retrieval if the LLM ever
 * gets to pick URLs there, etc.).
 */
export class SSRFError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SSRFError";
  }
}

export async function rejectIfPrivateAddress(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (e) {
    throw new SSRFError(`Invalid URL: ${rawUrl}`);
  }

  // Only http(s). Block file://, gopher://, ftp://, data:, javascript:, etc.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SSRFError(`Scheme "${url.protocol}" not allowed — only http(s)`);
  }

  // String hostname checks (cheaper than DNS, catches the easy cases)
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new SSRFError(`Hostname "${host}" blocked (loopback alias)`);
  }
  // metadata.google.internal — GCP metadata
  if (host === "metadata.google.internal" || host === "metadata") {
    throw new SSRFError(`Hostname "${host}" blocked (cloud metadata alias)`);
  }

  // If the hostname is already a literal IP, check it directly. No DNS
  // round-trip needed.
  const trimmed = host.replace(/^\[|\]$/g, ""); // strip brackets from IPv6
  if (isIPv4(trimmed) || isIPv6(trimmed)) {
    const restriction = checkAddressRestriction(trimmed);
    if (restriction) {
      throw new SSRFError(`Resolved IP ${trimmed} is in ${restriction} — blocked`);
    }
    return;
  }

  // DNS rebinding defence: resolve the hostname ourselves and check
  // every returned address. We MUST do this check rather than trusting
  // the hostname string — an attacker can register attacker.com that
  // resolves to 127.0.0.1 to bypass naive hostname blocking.
  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = await lookup(host, { all: true });
  } catch (e: any) {
    // DNS failure — fail closed (don't fetch what we can't resolve).
    throw new SSRFError(`DNS lookup failed for ${host}: ${e?.code || e?.message || "unknown"}`);
  }
  if (addrs.length === 0) {
    throw new SSRFError(`DNS lookup returned no addresses for ${host}`);
  }
  for (const { address } of addrs) {
    const restriction = checkAddressRestriction(address);
    if (restriction) {
      throw new SSRFError(
        `Hostname ${host} resolves to ${address} which is in ${restriction} — blocked (possible DNS rebinding)`,
      );
    }
  }
}
