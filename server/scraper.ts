import { URL } from "url";
import dns from "dns/promises";

const USER_AGENT = "Mozilla/5.0 (compatible; DealflowBot/1.0)";
const FETCH_TIMEOUT = 15000;
const MAX_URLS = 5;
const MAX_RESPONSE_SIZE = 2 * 1024 * 1024;

const BLOCKED_HOSTNAMES = new Set([
  "localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]",
  "metadata.google.internal", "metadata.google.com",
]);

function isPrivateIp(ip: string): boolean {
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("172.")) {
    const second = parseInt(ip.split(".")[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  if (ip.startsWith("192.168.")) return true;
  if (ip.startsWith("169.254.")) return true;
  if (ip === "127.0.0.1" || ip === "0.0.0.0") return true;
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80")) return true;
  return false;
}

async function validateUrl(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    if (BLOCKED_HOSTNAMES.has(parsed.hostname)) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname) && isPrivateIp(parsed.hostname)) return false;

    try {
      const addresses = await dns.resolve4(parsed.hostname);
      if (addresses.some(isPrivateIp)) return false;
    } catch {}

    return true;
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/json,text/plain",
      },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

function stripHtmlToText(html: string): string {
  let text = html;
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "");
  text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/\s+/g, " ");
  return text.trim();
}

function extractMetaTags(html: string): Record<string, string> {
  const meta: Record<string, string> = {};

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) meta.title = titleMatch[1].trim();

  const metaPatterns = [
    /name\s*=\s*["']description["'][^>]*content\s*=\s*["']([\s\S]*?)["']/gi,
    /content\s*=\s*["']([\s\S]*?)["'][^>]*name\s*=\s*["']description["']/gi,
  ];
  for (const pattern of metaPatterns) {
    const match = pattern.exec(html);
    if (match) { meta.description = match[1].trim(); break; }
  }

  const ogPatterns = [
    { key: "og:title", regex: /property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([\s\S]*?)["']/i },
    { key: "og:description", regex: /property\s*=\s*["']og:description["'][^>]*content\s*=\s*["']([\s\S]*?)["']/i },
    { key: "og:site_name", regex: /property\s*=\s*["']og:site_name["'][^>]*content\s*=\s*["']([\s\S]*?)["']/i },
    { key: "og:url", regex: /property\s*=\s*["']og:url["'][^>]*content\s*=\s*["']([\s\S]*?)["']/i },
  ];
  for (const { key, regex } of ogPatterns) {
    const match = regex.exec(html);
    if (match) meta[key] = match[1].trim();
  }

  const twitterPatterns = [
    { key: "twitter:title", regex: /name\s*=\s*["']twitter:title["'][^>]*content\s*=\s*["']([\s\S]*?)["']/i },
    { key: "twitter:description", regex: /name\s*=\s*["']twitter:description["'][^>]*content\s*=\s*["']([\s\S]*?)["']/i },
  ];
  for (const { key, regex } of twitterPatterns) {
    const match = regex.exec(html);
    if (match) meta[key] = match[1].trim();
  }

  return meta;
}

function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const linkPattern = /href\s*=\s*["'](https?:\/\/[^"'\s>]+)["']/gi;
  let match;
  while ((match = linkPattern.exec(html)) !== null) {
    links.push(match[1]);
  }
  return [...new Set(links)].slice(0, 30);
}

export interface ScrapedContent {
  url: string;
  title: string;
  metaDescription: string;
  ogData: Record<string, string>;
  bodyText: string;
  links: string[];
  fetchedSuccessfully: boolean;
  linkedWebsite: string;
}

function findLinkedWebsite(html: string, links: string[], sourceUrl: string): string {
  const sourceDomain = new URL(sourceUrl).hostname.replace("www.", "");

  const bioSection = html.match(/<div[^>]*(?:bio|description|profile|header)[^>]*>([\s\S]*?)<\/div>/gi);
  const searchArea = bioSection ? bioSection.join(" ") : html;

  for (const link of links) {
    try {
      const linkDomain = new URL(link).hostname.replace("www.", "");
      if (linkDomain === sourceDomain) continue;
      if (["twitter.com", "x.com", "facebook.com", "instagram.com", "linkedin.com",
           "youtube.com", "github.com", "t.co", "bit.ly", "tiktok.com"].includes(linkDomain)) continue;
      if (searchArea.includes(link)) return link;
    } catch {}
  }

  for (const link of links) {
    try {
      const linkDomain = new URL(link).hostname.replace("www.", "");
      if (linkDomain === sourceDomain) continue;
      if (["twitter.com", "x.com", "facebook.com", "instagram.com", "linkedin.com",
           "youtube.com", "github.com", "t.co", "bit.ly", "tiktok.com",
           "google.com", "apple.com", "apps.apple.com", "play.google.com"].includes(linkDomain)) continue;
      return link;
    } catch {}
  }

  return "";
}

export async function scrapeUrl(url: string): Promise<ScrapedContent> {
  const result: ScrapedContent = {
    url,
    title: "",
    metaDescription: "",
    ogData: {},
    bodyText: "",
    links: [],
    fetchedSuccessfully: false,
    linkedWebsite: "",
  };

  try {
    const safe = await validateUrl(url);
    if (!safe) {
      console.log(`[Scraper] Blocked unsafe URL: ${url}`);
      return result;
    }

    const response = await fetchWithTimeout(url, FETCH_TIMEOUT);
    if (!response.ok) return result;

    const contentType = response.headers.get("content-type") || "";
    const body = await response.text();

    if (contentType.includes("html") || body.trim().startsWith("<")) {
      const meta = extractMetaTags(body);
      result.title = meta.title || meta["og:title"] || meta["twitter:title"] || "";
      result.metaDescription = meta.description || meta["og:description"] || meta["twitter:description"] || "";
      result.ogData = meta;
      result.bodyText = stripHtmlToText(body).slice(0, 8000);
      result.links = extractLinks(body, url);
      result.linkedWebsite = findLinkedWebsite(body, result.links, url);
      result.fetchedSuccessfully = true;
    } else if (contentType.includes("json")) {
      result.bodyText = body.slice(0, 8000);
      result.fetchedSuccessfully = true;
    } else {
      result.bodyText = body.slice(0, 4000);
      result.fetchedSuccessfully = true;
    }
  } catch (error: any) {
    console.log(`[Scraper] Failed to fetch ${url}: ${error.message}`);
  }

  return result;
}

export async function scrapeMultiple(urls: string[]): Promise<ScrapedContent[]> {
  const limited = urls.slice(0, MAX_URLS);
  const results = await Promise.all(limited.map((u) => scrapeUrl(u)));
  return results;
}
