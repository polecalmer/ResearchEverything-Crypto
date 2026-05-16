/**
 * Playwright/Chromium browser fallback for web_fetch.
 *
 * Loaded lazily by web-tools.ts when:
 *   (a) the URL is on a known JS-required host (X.com, Twitter, LinkedIn, Medium)
 *   (b) the direct fetch path returned an error (4xx/5xx/cloudflare)
 *
 * Architecture mirrors hermes' `browser_tool.py`:
 *   - One browser instance, kept warm across calls (reused for ~30s of idle)
 *   - Fresh context (incognito-equivalent) per call, so state doesn't leak
 *   - Realistic UA + locale + viewport to avoid trivial bot detection
 *   - Aggressive timeouts: a hanging browser is worse than no browser
 *
 * For HEAVY anti-bot work (X.com login walls, Cloudflare Pro, etc.) hermes
 * uses Camoufox + Browserbase. We start with vanilla Chromium — for the
 * common case (public tweets, news pages, github, docs) it's enough.
 * Upgrade path: swap `chromium` for `firefox` + camoufox-launcher if
 * detection becomes a problem.
 */

import { logger } from "./logger";

let _browserPromise: Promise<any> | null = null;
let _lastUseAt = 0;
const IDLE_CLOSE_MS = 30_000;

async function getBrowser(): Promise<any> {
  // Reuse an existing browser if it hasn't been idle too long.
  if (_browserPromise && Date.now() - _lastUseAt < IDLE_CLOSE_MS) {
    return _browserPromise;
  }
  if (_browserPromise) {
    try {
      const b = await _browserPromise;
      await b.close().catch(() => {});
    } catch {}
    _browserPromise = null;
  }

  _browserPromise = (async () => {
    // Lazy require — throws a clear error if playwright isn't installed.
    let playwright: any;
    try {
      playwright = await import("playwright");
    } catch (err: any) {
      throw new Error(
        `Playwright not installed (\`${err?.message}\`). Run \`npm install playwright && npx playwright install chromium\` and restart.`,
      );
    }

    const browser = await playwright.chromium.launch({
      headless: true,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
    logger.info("web_fetch.browser launched (chromium, headless)");
    return browser;
  })();

  return _browserPromise;
}

/** Fetch a URL via a headless Chromium browser and return the rendered HTML.
 *  Caller is responsible for stripping HTML to text (web-tools.ts htmlToText).
 *  Resolves with the page's `outerHTML` after `networkidle`, or rejects
 *  with a useful error on timeout / nav-failure. */
export async function fetchViaBrowser(url: string, timeoutMs = 15_000): Promise<string> {
  const browser = await getBrowser();
  _lastUseAt = Date.now();

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "en-US",
    timezoneId: "America/New_York",
    // Don't load images / fonts — speeds up significantly, content is what matters.
    extraHTTPHeaders: {
      "accept-language": "en-US,en;q=0.9",
    },
  });

  // Block heavy resources to keep things fast — same trick hermes uses.
  await context.route("**/*", (route: any) => {
    const r = route.request();
    const rt = r.resourceType();
    if (rt === "image" || rt === "font" || rt === "media") {
      return route.abort();
    }
    return route.continue();
  });

  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    // Give JS a moment to hydrate. networkidle is too strict for X.com
    // (always has open websockets); domcontentloaded + brief wait is the
    // sweet spot in practice.
    await page.waitForTimeout(1500);
    const html: string = await page.content();
    logger.info({ url, htmlChars: html.length }, "web_fetch.browser ok");
    return html;
  } catch (err: any) {
    throw new Error(`Browser fetch failed for ${url}: ${err?.message || String(err)}`);
  } finally {
    await context.close().catch(() => {});
  }
}

/** Shut down the browser. Called on graceful shutdown. */
export async function closeBrowser(): Promise<void> {
  if (!_browserPromise) return;
  try {
    const b = await _browserPromise;
    await b.close();
    logger.info("web_fetch.browser closed");
  } catch {}
  _browserPromise = null;
}
