import { scrapeUrl, scrapeMultiple, type ScrapedContent } from "./scraper";
import crypto from "crypto";

export interface AdjacentRead {
  title: string;
  url: string;
  source: string;
  relevance: string;
}

export interface EnrichedCompany {
  name: string;
  oneLiner: string;
  description: string;
  sector: string;
  subSector: string;
  businessModel: string;
  stage: string;
  fundingHistory: string;
  competitiveLandscape: string;
  websiteUrl: string;
  githubUrl: string;
  twitterUrl: string;
  linkedinUrl: string;
  tags: string[];
  founders: {
    name: string;
    role: string;
    bio: string;
    linkedinUrl: string;
    twitterUrl: string;
    githubUrl: string;
    personalUrl: string;
    priorCompanies: string;
  }[];
  adjacentReads?: AdjacentRead[];
  hasLiquidToken?: boolean;
  tokenTier?: string;
  tokenTicker?: string;
  tokenContractAddress?: string;
  tokenChain?: string;
  liquidTokenAnalysis?: string;
}

const SECTORS = [
  "AI / ML", "AI Infra", "Fintech", "DevTools", "Consumer", "Healthcare",
  "Climate", "Crypto / Web3", "Enterprise SaaS", "Marketplace",
  "Cybersecurity", "Biotech", "Edtech", "Other",
];

const BUSINESS_MODELS = [
  "SaaS", "Marketplace", "Infrastructure", "Consumer", "API / Platform",
  "Hardware", "Services", "Open Source", "Other",
];

const STAGES = ["Pre-seed", "Seed", "Series A", "Series B", "Growth", "Public", "Liquid Token"];

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export const MARKUP_MULTIPLIER = 1;
export const ENRICHMENT_CHARGE = 0.50;
export const DEEP_RESEARCH_CHARGE = 1.50;
export const TOKEN_ANALYSIS_CHARGE = 1.50;

const enrichmentCostHistory: number[] = [];
const MAX_HISTORY = 50;

export function calculateChargeAmount(apiCost: number): number {
  return apiCost * MARKUP_MULTIPLIER;
}

export function getEstimatedEnrichmentCost(): number {
  return ENRICHMENT_CHARGE;
}

export function recordEnrichmentCost(apiCost: number): void {
  enrichmentCostHistory.push(apiCost);
  if (enrichmentCostHistory.length > MAX_HISTORY) {
    enrichmentCostHistory.shift();
  }
}

export function getLastEnrichmentCost(): { apiCost: number; totalCharge: number } | null {
  if (enrichmentCostHistory.length === 0) return null;
  const last = enrichmentCostHistory[enrichmentCostHistory.length - 1];
  return { apiCost: last, totalCharge: calculateChargeAmount(last) };
}

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: string; content: string }>;
  tools?: Array<{ type: string; name: string; max_uses?: number }>;
}

export function buildAnthropicRequest(systemPrompt: string, userMessage: string, useWebSearch: boolean = false, maxTokens: number = 16000, maxSearchUses: number = 10): AnthropicRequest {
  const request: AnthropicRequest = {
    model: "claude-opus-4-6",
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  };
  if (useWebSearch) {
    request.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: maxSearchUses }];
  }
  return request;
}

interface TokenIdentification {
  hasLiquidToken: boolean;
  tokenTicker: string;
  contractAddress: string;
  chain: string;
  tokenTier: string;
  classificationReasoning: string;
  valueAccrualMechanism: string;
  revenueModel: string;
}

interface EnrichmentSession {
  id: string;
  type: "enrichment";
  userId: string;
  input: string;
  scrapedContent: ScrapedContent[];
  step: number;
  identity?: any;
  tokenIdentification?: TokenIdentification;
  researchDraft?: any;
  verifiedData?: any;
  usage: TokenUsage;
  mppCost: number;
  createdAt: number;
}

interface NextStepsSession {
  id: string;
  type: "next-steps";
  userId: string;
  companyId: string;
  step: number;
  generatedSteps?: NextStepItem[];
  dealContext: any;
  usage: TokenUsage;
  mppCost: number;
  createdAt: number;
}

interface DeepResearchSession {
  id: string;
  type: "deep-research";
  userId: string;
  companyId: string;
  reportId: string;
  usage: TokenUsage;
  mppCost: number;
  createdAt: number;
}

type Session = EnrichmentSession | NextStepsSession | DeepResearchSession;
const sessions = new Map<string, Session>();
const SESSION_TTL = 10 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL) {
      sessions.delete(id);
    }
  }
}, 60_000);

function parseJson(text: string): any {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const braceStart = cleaned.indexOf("{");
    const braceEnd = cleaned.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd > braceStart) {
      return JSON.parse(cleaned.slice(braceStart, braceEnd + 1));
    }
    const bracketStart = cleaned.indexOf("[");
    const bracketEnd = cleaned.lastIndexOf("]");
    if (bracketStart !== -1 && bracketEnd > bracketStart) {
      return JSON.parse(cleaned.slice(bracketStart, bracketEnd + 1));
    }
    throw new Error("No valid JSON found in response");
  }
}

// ─── AGENT 1: IDENTIFIER ────────────────────────────────────────────────────

const IDENTIFIER_SYSTEM = `You are the Identifier Agent in a VC deal intelligence pipeline. Your ONLY job is to figure out which company/startup is being referenced from any piece of input.

YOU HAVE WEB SEARCH ACCESS. If the input is a URL or mentions a company you're not sure about, use web search to look it up and confirm the company identity.

The input could be:
- A company website URL
- A tweet or X/Twitter post about a company
- A founder's Twitter/X or LinkedIn profile
- A blog post, article, or news story
- A Product Hunt page, GitHub repo, Crunchbase link
- A plain company name or text snippet

You must determine:
1. The official company name
2. The company's website/domain (if you know it)
3. A brief note on how you identified the company from the input

CRITICAL RULES:
- If you are NOT confident about which company is referenced, say so in your reasoning.
- Do NOT guess. If the input is ambiguous, list possible candidates.
- If the input is clearly a person's profile, identify their CURRENT primary company.

Return ONLY valid JSON:
{
  "companyName": "Official company name",
  "domain": "company-domain.com or empty string if unknown",
  "confidence": "high" | "medium" | "low",
  "reasoning": "Brief explanation of how you identified this company",
  "alternativeCandidates": ["Other possible companies if ambiguous"]
}`;

function buildIdentifierRequest(input: string, scrapedContent?: ScrapedContent[]): AnthropicRequest {
  let prompt = `Identify the company from this input:\n\n${input}`;
  if (scrapedContent && scrapedContent.length > 0) {
    prompt += `\n\n--- SCRAPED WEB CONTENT ---\nI fetched the following content from the URLs in the input. Use this REAL data to identify the company:\n`;
    for (const sc of scrapedContent) {
      if (!sc.fetchedSuccessfully) continue;
      prompt += `\n[URL: ${sc.url}]\nTitle: ${sc.title}\nMeta Description: ${sc.metaDescription}\n`;
      if (sc.linkedWebsite) prompt += `Linked Website Found: ${sc.linkedWebsite}\n`;
      if (sc.ogData["og:site_name"]) prompt += `Site Name: ${sc.ogData["og:site_name"]}\n`;
      prompt += `Body excerpt: ${sc.bodyText.slice(0, 2000)}\n`;
    }
  }
  return buildAnthropicRequest(IDENTIFIER_SYSTEM, prompt, true);
}

// ─── AGENT 1.5: TOKEN IDENTIFIER ─────────────────────────────────────────────

const TOKEN_IDENTIFIER_SYSTEM = `You are the Token Identifier Agent in a VC deal intelligence pipeline. Your ONLY job is to determine whether a company/project has a liquid token (a token currently trading on exchanges).

YOU HAVE WEB SEARCH ACCESS. Use it to:
- Search for "[company name] token" or "[company name] cryptocurrency"
- Check CoinGecko, CoinMarketCap, or DEX aggregators for the token
- Look for token contract addresses on block explorers
- Check if the token is listed on any CEX or DEX

CLASSIFICATION TIERS (from the Liquid Token Analysis Framework):

Tier 0 — Monetary Premium:
- No intrinsic value from protocol cash flows
- Trade on belief, narrative, lindyness, or moneyness
- Examples: BTC, DOGE, ETH (partially)

Tier 1 — Great Tokens:
- Product has strong PMF, fees are high in absolute terms
- Fees drive token value accrual (staking/distribution or buybacks/burns)
- Good token distribution (initial float 25-45%)
- Examples: HYPE

Tier 2 — Average Tokens:
- Some PMF but scaling path unclear
- Fees exist but low relative to valuation
- Value accrual mechanism exists
- Examples: PUMP, AERO, AAVE, ENA, MORPHO

Tier 3 — Bad Tokens:
- No PMF, predatory tokenomics, low float
- No revenues, no value accrual
- Examples: MOVE, OM

CLASSIFICATION DECISION TREE:
1. Does the protocol generate meaningful recurring revenue? No → Tier 0 or Tier 3
2. If no revenue: does the token trade on monetary premium/network effects? Yes → Tier 0. No → Tier 3
3. If revenue exists: is it high in absolute terms AND growing? Yes → Tier 1. No → Tier 2
4. Is token distribution fair (25-45% initial float)? No → downgrade one tier
5. Is there clear value accrual linking fees to token holders? No → downgrade one tier

Return ONLY valid JSON:
{
  "hasLiquidToken": true/false,
  "tokenTicker": "TOKEN or empty string if none",
  "contractAddress": "0x... or empty string if unknown/none",
  "chain": "ethereum/solana/arbitrum/base/etc or empty string if unknown/none",
  "tokenTier": "Tier 0/Tier 1/Tier 2/Tier 3 or empty string if no token",
  "classificationReasoning": "2-3 sentences explaining the tier classification based on revenue, PMF, distribution, and value accrual",
  "valueAccrualMechanism": "direct_distribution/buyback_burn/buyback_hold/indirect/none or empty string",
  "revenueModel": "Brief description of how the protocol generates revenue, or empty string"
}`;

function buildTokenIdentifierRequest(companyName: string, domain: string): AnthropicRequest {
  const prompt = `Determine whether "${companyName}" (${domain || "domain unknown"}) has a liquid token trading on exchanges.

Search for:
1. "${companyName} token" or "${companyName} cryptocurrency"
2. Check CoinGecko/CoinMarketCap for the token
3. Look for token contract addresses
4. Determine the token tier based on the classification framework

If the project has a token, classify it into Tier 0-3 based on:
- Revenue generation and PMF
- Value accrual mechanism
- Token distribution quality
- Growth trajectory`;
  return buildAnthropicRequest(TOKEN_IDENTIFIER_SYSTEM, prompt, true);
}

// ─── AGENT 1.5a: CONTRACT ADDRESS FINDER ──────────────────────────────────────

const CONTRACT_FINDER_SYSTEM = `You are the Contract Address Finder Agent in a VC deal intelligence pipeline. Given a token ticker and its associated project/chain, your job is to find ALL known contract addresses for this token across every blockchain it exists on.

YOU HAVE WEB SEARCH ACCESS. Use it to:
- Search CoinGecko, CoinMarketCap, and DeFiLlama for the token's contract addresses
- Check block explorers (Etherscan, Basescan, Arbiscan, Solscan, etc.)
- Search for "[token] contract address" and "[token] token address [chain]"
- Check the project's official documentation for canonical contract addresses
- Look for bridge/wrapped versions on other chains

IMPORTANT RULES:
- Find the NATIVE/canonical deployment first, then bridged/wrapped versions
- For tokens native to their own L1 (e.g., HYPE on Hyperliquid), note if the L1 has an EVM-compatible address or if the token exists as a wrapped version on an EVM chain
- Include ALL chains where the token has meaningful liquidity
- For each address, note whether it's the canonical/native version or a bridged/wrapped version

Return ONLY valid JSON:
{
  "tokenTicker": "TOKEN",
  "addresses": [
    {
      "chain": "ethereum/arbitrum/base/solana/hyperliquid/etc",
      "contractAddress": "0x... or native",
      "addressType": "native/wrapped/bridged",
      "source": "where you found this address (coingecko/docs/explorer/etc)",
      "confidence": "high/medium/low"
    }
  ],
  "notes": "Any relevant context about the token's multi-chain presence"
}`;

function buildContractFinderRequest(tokenTicker: string, companyName: string, chain: string): AnthropicRequest {
  const prompt = `Find ALL contract addresses for the token "${tokenTicker}" associated with the project "${companyName}".
${chain ? `The token was initially detected on chain: "${chain}"` : "The chain is unknown — search broadly."}

Search for:
1. "${tokenTicker} contract address" on CoinGecko, CoinMarketCap
2. "${tokenTicker} token address ${chain || ''}" on block explorers
3. "${companyName} token contract" in official docs
4. Check if the token exists on multiple chains (Ethereum, Arbitrum, Base, Solana, etc.)
5. For L1-native tokens, check if there's a wrapped/bridged version on EVM chains

Return ALL addresses found with their chain, type, and confidence level.`;
  return buildAnthropicRequest(CONTRACT_FINDER_SYSTEM, prompt, true, 4000, 8);
}

// ─── AGENT 1.5b: CONTRACT ADDRESS VERIFIER ────────────────────────────────────

const CONTRACT_VERIFIER_SYSTEM = `You are the Contract Address Verifier Agent in a VC deal intelligence pipeline. You receive a list of candidate contract addresses for a token and must verify them, then select the PRIMARY address to use.

YOU HAVE WEB SEARCH ACCESS. Use it to:
- Verify each contract address on its respective block explorer
- Check that the contract matches the expected token (correct name, symbol, decimals)
- Look up trading volume and liquidity on each chain
- Verify the deployer/creator address is associated with the official project

VERIFICATION CRITERIA:
1. Address exists on the claimed chain and is a valid token contract
2. Token name/symbol matches the expected token
3. Contract is not a scam/copycat (check deployer, creation date, holder count)
4. Meaningful liquidity exists (DEX pools, CEX listings)

PRIMARY ADDRESS SELECTION (pick the most useful for analysis):
- Prefer the chain with the HIGHEST trading volume and liquidity
- If roughly equal, prefer EVM chains (better tooling/analysis support)
- If token is native to its own L1 with no EVM presence, use the L1 address
- The primary address should be the one most useful for on-chain analysis

Return ONLY valid JSON:
{
  "tokenTicker": "TOKEN",
  "verified": true/false,
  "primaryAddress": {
    "contractAddress": "0x... or native identifier",
    "chain": "the chain name",
    "addressType": "native/wrapped/bridged"
  },
  "allVerifiedAddresses": [
    {
      "chain": "chain name",
      "contractAddress": "address",
      "addressType": "native/wrapped/bridged",
      "verified": true/false,
      "verificationNotes": "brief note on verification result"
    }
  ],
  "verificationSummary": "1-2 sentences on what was verified and why the primary was chosen"
}`;

function buildContractVerifierRequest(tokenTicker: string, companyName: string, candidateAddresses: any[]): AnthropicRequest {
  const prompt = `Verify the following candidate contract addresses for token "${tokenTicker}" (project: "${companyName}"):

${JSON.stringify(candidateAddresses, null, 2)}

For each address:
1. Verify it exists on the claimed chain
2. Confirm the token name/symbol matches "${tokenTicker}"
3. Check for meaningful liquidity/volume
4. Determine if it's the official/canonical deployment

Then select the PRIMARY address — the one with the highest liquidity and best analysis support.`;
  return buildAnthropicRequest(CONTRACT_VERIFIER_SYSTEM, prompt, true, 4000, 8);
}

// ─── AGENT 2: RESEARCH ──────────────────────────────────────────────────────

const RESEARCH_SYSTEM = `You are the Research Agent in a VC deal intelligence pipeline. You receive a confirmed company identity and must produce a comprehensive deal card.

YOU HAVE WEB SEARCH ACCESS. Use it aggressively to find real, current information about the company. Search for:
- The company's official website
- Recent news, press releases, funding announcements
- Crunchbase, PitchBook, or similar profiles
- Founder backgrounds and LinkedIn profiles
- Product descriptions and user reviews

YOUR MANDATE:
- Use web search to gather REAL facts. Do not rely on guessing.
- Only include facts you are HIGHLY CONFIDENT about from your web search results or scraped data.
- For anything you are uncertain about, use empty string or leave it out.
- NEVER fabricate funding amounts, investor names, dates, or LinkedIn URLs.
- If you are not sure about a founder's exact role, prior companies, or bio details, leave those fields empty rather than guessing.
- Clearly distinguish between what you KNOW vs what you're INFERRING.

For funding history: ONLY include rounds you are certain actually happened. Do NOT make up dollar amounts or investor names. If you don't know specific details, say "Details not confirmed" or leave empty.

For founders AND key team members:
- Include founders/co-founders AND key executives (CTO, VP Eng, Head of Product, etc.) — up to 5 people total.
- Use "Founder", "Co-founder", "Co-founder & CTO", "CTO", "VP Engineering", etc. as role values.
- Search the web for EACH person individually to build rich bios. Do NOT just summarize their LinkedIn headline.
- Write bios from an INVESTOR's perspective — what makes this person uniquely qualified? Include:
  - Domain expertise and why it's relevant to this company
  - Notable achievements, exits, or companies built/scaled
  - Technical depth (papers published, open source contributions, patents)
  - Education ONLY if from a notable program or directly relevant
  - Industry recognition, speaking engagements, or thought leadership
  - Years of experience in the relevant domain
- Bio should be 3-5 sentences, narrative style, NOT a bullet-point LinkedIn summary.
- For priorCompanies: include role context, e.g. "Stripe (Engineering Lead), Google (Senior SWE), YC W19"

For competitive landscape: Only list companies that genuinely compete in the same space.

IMPORTANT: Use web search to find the company's REAL URLs:
- Official website URL
- GitHub organization URL (if they have one)
- Twitter/X profile URL
- LinkedIn company page URL
- For each founder/team member: their LinkedIn, Twitter/X, GitHub, and personal website URLs

Return ONLY valid JSON matching this schema:
{
  "name": "Company name",
  "oneLiner": "What they do in one sentence",
  "description": "2-3 paragraph description",
  "sector": "One of: ${SECTORS.join(", ")}",
  "subSector": "Specific niche within the sector. For Crypto/Web3: use one of Prediction Markets, Perpetuals/Derivatives, DEX, Lending/Borrowing, Stablecoins, NFT/Gaming, Infrastructure/L1/L2, Bridges, Oracles, DePIN, RWA, DAO Tooling, Wallet, Analytics, MEV, Restaking, Social, Privacy, Payments, or other specific niche. For other sectors: use a specific sub-category (e.g., 'LLM Ops' for AI/ML, 'Neobank' for Fintech). Empty string if unclear.",
  "businessModel": "One of: ${BUSINESS_MODELS.join(", ")}",
  "stage": "One of: ${STAGES.join(", ")}",
  "fundingHistory": "Confirmed funding rounds only, or empty string",
  "competitiveLandscape": "Known competitors and differentiation",
  "websiteUrl": "Official company website URL or empty string",
  "githubUrl": "GitHub org/repo URL or empty string",
  "twitterUrl": "Twitter/X profile URL or empty string",
  "linkedinUrl": "LinkedIn company page URL or empty string",
  "tags": ["2-5 relevant tags"],
  "founders": [
    {
      "name": "Full name",
      "role": "Title (Founder, Co-founder, CTO, VP Eng, etc.)",
      "bio": "3-5 sentence investor-perspective narrative bio — NOT a LinkedIn summary",
      "linkedinUrl": "Verified LinkedIn profile URL or empty string",
      "twitterUrl": "Verified Twitter/X profile URL or empty string",
      "githubUrl": "Verified GitHub profile URL or empty string",
      "personalUrl": "Verified personal website URL or empty string",
      "priorCompanies": "Companies with role context, e.g. 'Stripe (Eng Lead), Google (Sr SWE)'"
    }
  ],
  "confidenceNotes": {
    "highConfidence": ["list of fields you are very confident about"],
    "mediumConfidence": ["fields with moderate confidence"],
    "lowConfidence": ["fields you are less sure about"]
  }
}`;

function buildResearchRequest(companyName: string, domain: string, originalInput: string, scrapedContent?: ScrapedContent[]): AnthropicRequest {
  let prompt = `Research this company thoroughly:
Company: ${companyName}
Domain: ${domain || "unknown"}
Original input that led to identification: ${originalInput}`;

  if (scrapedContent && scrapedContent.length > 0) {
    prompt += `\n\n--- SCRAPED WEB CONTENT ---\nThe following content was fetched from URLs. Use this as primary source material:\n`;
    for (const sc of scrapedContent) {
      if (!sc.fetchedSuccessfully) continue;
      prompt += `\n[URL: ${sc.url}]\nTitle: ${sc.title}\nMeta Description: ${sc.metaDescription}\n`;
      if (sc.linkedWebsite) prompt += `Linked Website Found: ${sc.linkedWebsite}\n`;
      if (sc.ogData["og:site_name"]) prompt += `Site Name: ${sc.ogData["og:site_name"]}\n`;
      prompt += `Body excerpt: ${sc.bodyText.slice(0, 3000)}\n`;
      if (sc.links.length > 0) prompt += `Outbound links: ${sc.links.slice(0, 15).join(", ")}\n`;
    }
  }

  return buildAnthropicRequest(RESEARCH_SYSTEM, prompt, true);
}

// ─── AGENT 3: VERIFY & CLEAN ────────────────────────────────────────────────

const VERIFY_AND_CLEAN_SYSTEM = `You are the Verify & Clean Agent — the final quality gate in a VC deal intelligence pipeline. You receive a research draft about a company and must:
1. VERIFY: Rigorously fact-check every claim in the draft
2. CLEAN: Produce the final deal card with all unverified/hallucinated content removed

YOU HAVE WEB SEARCH ACCESS. Use it to independently verify claims. Search for the company, its funding rounds, founders, and competitors to cross-check the information.

VERIFICATION FOCUS — pay EXTRA attention to:
- Funding amounts and dates (commonly hallucinated)
- Investor names (commonly hallucinated)
- Founder AND key team member bios and prior companies (commonly embellished)
- LinkedIn/Twitter/GitHub URLs for ALL team members — these are THE MOST commonly hallucinated fields. You MUST use web search to verify each person's social profile actually exists at that URL. If you cannot confirm a URL exists via search, SET IT TO EMPTY STRING. Do NOT guess profile handles.
- Company stage (often guessed incorrectly)
- Specific metrics or user numbers (commonly fabricated)

CLEANING RULES — your output must be squeaky clean:
- REMOVE any claim you cannot verify — set to empty string or remove from array
- URLs (website, GitHub, Twitter, LinkedIn) → KEEP only if verified or follows correct platform format. REMOVE if fabricated.
- Funding amounts → remove specific dollar amounts unless verified; keep only what's confirmed
- Founder/team member bios → strip any unverified claims about education, roles, or achievements. Keep the narrative style — do NOT reduce to LinkedIn-style summaries.
- Description → remove any specific metrics, user counts, or revenue figures unless verified
- Do NOT add any new information — only keep, remove, or correct existing content
- When in doubt, OMIT

For sector, businessModel, stage: use EXACTLY one of these values or empty string:
Sectors: ${SECTORS.join(", ")}
Business Models: ${BUSINESS_MODELS.join(", ")}
Stages: ${STAGES.join(", ")}

Return ONLY valid JSON with the final clean deal card:
{
  "name": "Company name",
  "oneLiner": "One sentence",
  "description": "Clean description with unverified claims removed",
  "sector": "Verified sector or empty string",
  "subSector": "Verified sub-sector niche or empty string",
  "businessModel": "Verified model or empty string",
  "stage": "Verified stage or empty string",
  "fundingHistory": "Only verified funding info or empty string",
  "competitiveLandscape": "Only verified competitors",
  "websiteUrl": "Verified company website URL or empty string",
  "githubUrl": "Verified GitHub URL or empty string",
  "twitterUrl": "Verified Twitter/X URL or empty string",
  "linkedinUrl": "Verified LinkedIn URL or empty string",
  "tags": ["verified tags"],
  "founders": [
    {
      "name": "Verified name",
      "role": "Verified role or empty string",
      "bio": "Only verified bio info or empty string",
      "linkedinUrl": "Verified LinkedIn URL or empty string",
      "twitterUrl": "Verified Twitter/X URL or empty string",
      "githubUrl": "Verified GitHub URL or empty string",
      "personalUrl": "Verified personal website URL or empty string",
      "priorCompanies": "Only verified prior companies or empty string"
    }
  ],
  "verificationSummary": {
    "overallAssessment": "clean" | "concerns" | "major_issues",
    "issuesFound": 0,
    "removed": ["list of fields/claims that were removed"],
    "revised": ["list of fields/claims that were corrected"]
  }
}`;

function buildVerifyRequest(companyName: string, researchDraft: any): AnthropicRequest {
  const prompt = `Verify and clean this research draft about "${companyName}".

RESEARCH DRAFT:
${JSON.stringify(researchDraft, null, 2)}

Step 1: Use web search to independently verify the key claims — funding, founders, URLs, metrics.
Step 2: Produce the final clean deal card JSON with all unverified or hallucinated content stripped out. When in doubt, OMIT.`;
  return buildAnthropicRequest(VERIFY_AND_CLEAN_SYSTEM, prompt, true);
}

// ─── AGENT 4: DUE DILIGENCE READS ────────────────────────────────────────────

const DUE_DILIGENCE_READS_SYSTEM = `You are the Due Diligence Reads Agent in a VC deal intelligence pipeline. You receive a verified deal card about a company and must find 4-5 critical adjacent reads that an investor MUST review during due diligence.

YOU HAVE WEB SEARCH ACCESS. Use it aggressively to find the most important, non-obvious adjacent reads.

WHAT ARE "ADJACENT READS"?
These are NOT articles about the company itself. They are primary source documents, research papers, technical deep-dives, or analyses of the UNDERLYING technology, market thesis, regulatory landscape, or competitive dynamics that would inform an investment decision.

EXAMPLES:
- For a company building on a novel cryptographic technique → the original research paper on that technique
- For a DeFi protocol using a specific AMM design → the seminal paper or blog post explaining that design
- For a company in a regulated space → the key regulatory framework document or recent ruling
- For an AI company using a specific architecture → the arxiv paper introducing that architecture
- For a company entering a specific market → the definitive market analysis or industry report
- For a company with a novel consensus mechanism → the whitepaper describing that mechanism
- For a company building on top of another protocol → that protocol's documentation or audit reports

RULES:
- Find 4-5 reads maximum
- Each read MUST have a real, working URL that you found via web search
- Prioritize: research papers, whitepapers, technical blog posts, audit reports, regulatory documents, market analyses
- Do NOT include generic news articles about the company
- Do NOT include the company's own website or blog
- Each read should cover a DIFFERENT aspect of due diligence (technology, market, regulatory, competition, risk)
- Write a concise 1-sentence explanation of WHY this read matters for the investment decision

Return ONLY valid JSON:
{
  "adjacentReads": [
    {
      "title": "Title of the document/paper/article",
      "url": "https://actual-verified-url.com/...",
      "source": "Source name (e.g., arxiv, SEC, company blog, research firm)",
      "relevance": "One sentence on why this matters for due diligence on this deal"
    }
  ]
}`;

function buildDueDiligenceReadsRequest(companyName: string, verifiedData: any): AnthropicRequest {
  const prompt = `Find 4-5 critical adjacent reads for due diligence on "${companyName}".

VERIFIED DEAL CARD:
Company: ${companyName}
Sector: ${verifiedData.sector || "Unknown"}
Sub-sector: ${verifiedData.subSector || "Unknown"}
Description: ${verifiedData.description || ""}
Business Model: ${verifiedData.businessModel || ""}
Competitive Landscape: ${verifiedData.competitiveLandscape || ""}
Tags: ${(verifiedData.tags || []).join(", ")}

Search for the most important primary sources, research papers, technical deep-dives, regulatory documents, and market analyses that would inform an investment decision in this company. These should NOT be about the company itself — they should be about the underlying technology, market, or regulatory landscape.`;
  return buildAnthropicRequest(DUE_DILIGENCE_READS_SYSTEM, prompt, true, 4000, 10);
}

// ─── UTILITY FUNCTIONS ──────────────────────────────────────────────────────

function sanitizeUrl(url: any, expectedDomain?: string): string {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return "";
  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.replace("www.", "");
    if (expectedDomain && !hostname.includes(expectedDomain)) return "";
    if (hostname.includes("example.com") || hostname.includes("placeholder")) return "";
  } catch { return ""; }
  return trimmed;
}

function sanitizeFounderUrl(url: any, platform: string): string {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return "";

  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.replace("www.", "").toLowerCase();
    const path = parsed.pathname;

    if (platform === "linkedin") {
      if (!hostname.includes("linkedin.com")) return "";
      if (!path.startsWith("/in/") && !path.startsWith("/pub/")) return "";
      const handle = path.split("/")[2];
      if (!handle || handle.length < 2) return "";
    } else if (platform === "twitter") {
      if (!hostname.includes("twitter.com") && !hostname.includes("x.com")) return "";
      const handle = path.split("/")[1];
      if (!handle || handle.length < 1 || handle.startsWith("search") || handle.startsWith("home") || handle.startsWith("intent")) return "";
    } else if (platform === "github") {
      if (!hostname.includes("github.com")) return "";
      const handle = path.split("/")[1];
      if (!handle || handle.length < 1 || handle === "search" || handle === "explore" || handle === "topics") return "";
    }

    if (hostname.includes("example.com") || hostname.includes("placeholder")) return "";
  } catch { return ""; }
  return trimmed;
}

function sanitizeWebsiteUrl(url: any): string {
  const sanitized = sanitizeUrl(url);
  if (!sanitized) return "";
  try {
    const hostname = new URL(sanitized).hostname.replace("www.", "").toLowerCase();
    const socialDomains = [
      "twitter.com", "x.com", "linkedin.com", "github.com",
      "facebook.com", "instagram.com", "tiktok.com", "youtube.com",
      "reddit.com", "medium.com", "substack.com",
      "producthunt.com", "crunchbase.com", "pitchbook.com",
    ];
    if (socialDomains.some(d => hostname.includes(d))) return "";
  } catch { return ""; }
  return sanitized;
}

function validateOutput(data: any): EnrichedCompany {
  const result: EnrichedCompany = {
    name: data.name || "",
    oneLiner: data.oneLiner || "",
    description: data.description || "",
    sector: SECTORS.includes(data.sector) ? data.sector : "",
    subSector: typeof data.subSector === "string" ? data.subSector : "",
    businessModel: BUSINESS_MODELS.includes(data.businessModel) ? data.businessModel : "",
    stage: STAGES.includes(data.stage) ? data.stage : "",
    fundingHistory: data.fundingHistory || "",
    competitiveLandscape: data.competitiveLandscape || "",
    websiteUrl: sanitizeWebsiteUrl(data.websiteUrl),
    githubUrl: sanitizeUrl(data.githubUrl, "github.com"),
    twitterUrl: sanitizeUrl(data.twitterUrl, "x.com") || sanitizeUrl(data.twitterUrl, "twitter.com"),
    linkedinUrl: sanitizeUrl(data.linkedinUrl, "linkedin.com"),
    tags: Array.isArray(data.tags) ? data.tags.filter((t: any) => typeof t === "string") : [],
    founders: [],
  };

  if (Array.isArray(data.founders)) {
    result.founders = data.founders
      .filter((f: any) => f && typeof f.name === "string" && f.name.trim())
      .map((f: any) => ({
        name: f.name || "",
        role: f.role || "",
        bio: f.bio || "",
        linkedinUrl: sanitizeFounderUrl(f.linkedinUrl, "linkedin"),
        twitterUrl: sanitizeFounderUrl(f.twitterUrl, "twitter"),
        githubUrl: sanitizeFounderUrl(f.githubUrl, "github"),
        personalUrl: sanitizeUrl(f.personalUrl),
        priorCompanies: f.priorCompanies || "",
      }));
  }

  return result;
}

// ─── SCRAPING ────────────────────────────────────────────────────────────────

type ProgressCallback = (event: any) => void;

function extractUrls(text: string): string[] {
  const urlPattern = /https?:\/\/[^\s<>"')\]]+/gi;
  const matches = text.match(urlPattern) || [];
  return [...new Set(matches)];
}

async function scrapeInputUrls(input: string, onProgress?: ProgressCallback): Promise<ScrapedContent[]> {
  const urls = extractUrls(input);
  if (urls.length === 0) return [];

  const emit = (data: any) => { if (onProgress) onProgress(data); };
  emit({ type: "stage", agent: "scraper", step: 0, total: 6, message: `Fetching content from ${urls.length} URL(s)...` });
  console.log(`[Scraper] Fetching ${urls.length} URL(s): ${urls.join(", ")}`);

  const results = await scrapeMultiple(urls);
  const fetched = results.filter((r) => r.fetchedSuccessfully);
  console.log(`[Scraper] Successfully fetched ${fetched.length}/${urls.length} URLs`);

  const additionalUrls: string[] = [];
  for (const sc of fetched) {
    if (sc.linkedWebsite) {
      const alreadyScraped = results.some((r) => r.url === sc.linkedWebsite);
      if (!alreadyScraped && !additionalUrls.includes(sc.linkedWebsite)) {
        additionalUrls.push(sc.linkedWebsite);
      }
    }
  }

  if (additionalUrls.length > 0) {
    console.log(`[Scraper] Found linked company website(s), fetching: ${additionalUrls.join(", ")}`);
    emit({ type: "stage", agent: "scraper", step: 0, total: 6, message: `Found linked website — fetching company page...` });
    const additional = await scrapeMultiple(additionalUrls);
    results.push(...additional);
  }

  const totalFetched = results.filter((r) => r.fetchedSuccessfully).length;
  emit({ type: "stage_complete", agent: "scraper", step: 0, pagesFetched: totalFetched });
  console.log(`[Scraper] Total pages fetched: ${totalFetched}`);

  return results;
}

// ─── ENRICHMENT ORCHESTRATION ────────────────────────────────────────────────

export interface EnrichmentResult {
  enriched: EnrichedCompany;
  apiCost: number;
  totalCharge: number;
  tokenUsage: TokenUsage;
}

export async function startEnrichmentSession(input: string, userId: string): Promise<{
  sessionId: string;
  anthropicRequest: AnthropicRequest;
  progress: any[];
}> {
  const progress: any[] = [];
  const scrapedContent = await scrapeInputUrls(input, (e) => progress.push(e));

  const session: EnrichmentSession = {
    id: crypto.randomUUID(),
    type: "enrichment",
    userId,
    input,
    scrapedContent,
    step: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    mppCost: 0,
    createdAt: Date.now(),
  };
  sessions.set(session.id, session);

  const request = buildIdentifierRequest(input, scrapedContent);
  progress.push({ type: "stage", agent: "identifier", step: 1, total: 6, message: "Identifying company from input..." });
  console.log("[Enrichment] Session started. Agent 1/5: Identifier");

  return { sessionId: session.id, anthropicRequest: request, progress };
}

export async function advanceEnrichmentSession(
  sessionId: string,
  userId: string,
  responseText: string,
  responseUsage?: { input_tokens: number; output_tokens: number },
  mppCost?: number,
): Promise<{
  anthropicRequest?: AnthropicRequest;
  result?: EnrichmentResult;
  progress: any[];
}> {
  const session = sessions.get(sessionId);
  if (!session || session.type !== "enrichment") throw new Error("Invalid or expired session");
  if (session.userId !== userId) throw new Error("Session access denied");

  const progress: any[] = [];

  if (responseUsage) {
    session.usage.inputTokens += responseUsage.input_tokens;
    session.usage.outputTokens += responseUsage.output_tokens;
  }
  if (mppCost && mppCost > 0) {
    session.mppCost += mppCost;
  }

  const totalSteps = 6;

  // Step 0: Identifier complete → Token Identifier
  if (session.step === 0) {
    const identity = parseJson(responseText);
    session.identity = identity;
    session.step = 1;

    console.log(`[Enrichment] Identified: "${identity.companyName}" (confidence: ${identity.confidence})`);
    progress.push({ type: "stage_complete", agent: "identifier", step: 1, total: 6, companyName: identity.companyName, confidence: identity.confidence });

    if (identity.confidence === "low" && !identity.companyName) {
      sessions.delete(sessionId);
      throw new Error("Could not confidently identify a company from the provided input. Please try a more specific URL or company name.");
    }

    if (identity.domain && session.scrapedContent.every((sc) => !sc.url.includes(identity.domain))) {
      console.log(`[Scraper] Identifier found domain ${identity.domain} — fetching company website...`);
      const companySite = await scrapeUrl(`https://${identity.domain}`);
      if (companySite.fetchedSuccessfully) {
        session.scrapedContent.push(companySite);
        console.log(`[Scraper] Fetched company website: ${identity.domain}`);
      }
    }

    const request = buildTokenIdentifierRequest(identity.companyName, identity.domain);
    progress.push({ type: "stage", agent: "token_identifier", step: 2, total: 6, message: `Checking if ${identity.companyName} has a liquid token...` });
    console.log("[Enrichment] Agent 2/5: Token Identifier — detecting liquid token...");

    return { anthropicRequest: request, progress };
  }

  // Step 1: Token Identifier complete → Contract Finder (if token found) or Research
  if (session.step === 1) {
    const tokenResult = parseJson(responseText);
    const hasToken = tokenResult.hasLiquidToken === true;
    session.tokenIdentification = {
      hasLiquidToken: hasToken,
      tokenTicker: tokenResult.tokenTicker || "",
      contractAddress: tokenResult.contractAddress || "",
      chain: tokenResult.chain || "",
      tokenTier: tokenResult.tokenTier || "",
      classificationReasoning: tokenResult.classificationReasoning || "",
      valueAccrualMechanism: tokenResult.valueAccrualMechanism || "",
      revenueModel: tokenResult.revenueModel || "",
    };

    console.log(`[Enrichment] Token Identifier: hasLiquidToken=${hasToken}${hasToken ? ` (${tokenResult.tokenTicker}, ${tokenResult.tokenTier})` : ""}`);

    if (hasToken && tokenResult.tokenTicker) {
      session.step = 10;
      progress.push({
        type: "stage_complete",
        agent: "token_identifier",
        step: 2,
        total: totalSteps,
        hasLiquidToken: hasToken,
        tokenTicker: tokenResult.tokenTicker || "",
        tokenTier: tokenResult.tokenTier || "",
      });

      const request = buildContractFinderRequest(
        tokenResult.tokenTicker,
        session.identity.companyName,
        tokenResult.chain || "",
      );
      progress.push({ type: "stage", agent: "contract_finder", step: 2, total: totalSteps, message: `Finding contract addresses for ${tokenResult.tokenTicker}...` });
      console.log(`[Enrichment] Agent 2b: Contract Address Finder — searching for ${tokenResult.tokenTicker} addresses...`);

      return { anthropicRequest: request, progress };
    }

    session.step = 2;
    progress.push({
      type: "stage_complete",
      agent: "token_identifier",
      step: 2,
      total: totalSteps,
      hasLiquidToken: hasToken,
      tokenTicker: tokenResult.tokenTicker || "",
      tokenTier: tokenResult.tokenTier || "",
    });

    const request = buildResearchRequest(session.identity.companyName, session.identity.domain, session.input, session.scrapedContent);
    progress.push({ type: "stage", agent: "researcher", step: 3, total: totalSteps, message: `Researching ${session.identity.companyName}...` });
    console.log("[Enrichment] Agent 3/5: Research — building deal card...");

    return { anthropicRequest: request, progress };
  }

  // Step 10: Contract Finder complete → Contract Verifier
  if (session.step === 10) {
    const finderResult = parseJson(responseText);
    (session as any).contractFinderResult = finderResult;
    session.step = 11;

    const addresses = finderResult.addresses || [];
    console.log(`[Enrichment] Contract Finder: found ${addresses.length} candidate address(es) for ${finderResult.tokenTicker || session.tokenIdentification?.tokenTicker}`);

    if (addresses.length === 0) {
      console.log("[Enrichment] No contract addresses found — skipping verifier, proceeding to research.");
      session.step = 2;

      const request = buildResearchRequest(session.identity.companyName, session.identity.domain, session.input, session.scrapedContent);
      progress.push({ type: "stage", agent: "researcher", step: 3, total: totalSteps, message: `Researching ${session.identity.companyName}...` });
      console.log("[Enrichment] Agent 3/5: Research — building deal card...");

      return { anthropicRequest: request, progress };
    }

    const request = buildContractVerifierRequest(
      session.tokenIdentification!.tokenTicker,
      session.identity.companyName,
      addresses,
    );
    progress.push({ type: "stage", agent: "contract_verifier", step: 2, total: totalSteps, message: `Verifying contract addresses for ${session.tokenIdentification!.tokenTicker}...` });
    console.log(`[Enrichment] Agent 2c: Contract Verifier — verifying ${addresses.length} address(es)...`);

    return { anthropicRequest: request, progress };
  }

  // Step 11: Contract Verifier complete → update tokenIdentification → Research
  if (session.step === 11) {
    const verifierResult = parseJson(responseText);
    session.step = 2;

    if (verifierResult.verified && verifierResult.primaryAddress) {
      const primary = verifierResult.primaryAddress;
      session.tokenIdentification!.contractAddress = primary.contractAddress || session.tokenIdentification!.contractAddress;
      session.tokenIdentification!.chain = primary.chain || session.tokenIdentification!.chain;

      (session as any).allVerifiedAddresses = verifierResult.allVerifiedAddresses || [];

      console.log(`[Enrichment] Contract Verifier: PRIMARY = ${primary.contractAddress} on ${primary.chain} (${primary.addressType})`);
      console.log(`[Enrichment] Verification summary: ${verifierResult.verificationSummary || "N/A"}`);

      progress.push({
        type: "contract_verified",
        agent: "contract_verifier",
        step: 2,
        total: totalSteps,
        primaryAddress: primary.contractAddress,
        primaryChain: primary.chain,
        addressType: primary.addressType,
        allAddresses: verifierResult.allVerifiedAddresses?.filter((a: any) => a.verified) || [],
      });
    } else {
      console.log("[Enrichment] Contract Verifier: could not verify any address.");
    }

    const request = buildResearchRequest(session.identity.companyName, session.identity.domain, session.input, session.scrapedContent);
    progress.push({ type: "stage", agent: "researcher", step: 3, total: totalSteps, message: `Researching ${session.identity.companyName}...` });
    console.log("[Enrichment] Agent 3/5: Research — building deal card...");

    return { anthropicRequest: request, progress };
  }

  // Step 2: Research complete → Verify & Clean
  if (session.step === 2) {
    const researchDraft = parseJson(responseText);
    session.researchDraft = researchDraft;
    session.step = 3;

    console.log("[Enrichment] Research draft complete.");
    progress.push({ type: "stage_complete", agent: "researcher", step: 3, total: totalSteps });

    const request = buildVerifyRequest(session.identity.companyName, researchDraft);
    progress.push({ type: "stage", agent: "verify_clean", step: 4, total: totalSteps, message: "Verifying claims & cleaning output..." });
    console.log("[Enrichment] Agent 4/5: Verify & Clean — fact-checking...");

    return { anthropicRequest: request, progress };
  }

  // Step 3: Verify & Clean complete → DD Reads
  if (session.step === 3) {
    const parsed = parseJson(responseText);
    const summary = parsed.verificationSummary || {};
    const issuesFound = (summary.removed?.length || 0) + (summary.revised?.length || 0);
    const assessment = summary.overallAssessment || "clean";

    console.log(`[Enrichment] Verify & Clean: ${assessment} (${issuesFound} issues found)`);
    progress.push({ type: "stage_complete", agent: "verify_clean", step: 4, total: totalSteps, issuesFound, assessment });

    session.verifiedData = parsed;
    session.step = 4;

    const request = buildDueDiligenceReadsRequest(session.identity.companyName, parsed);
    progress.push({ type: "stage", agent: "dd_reads", step: 5, total: totalSteps, message: "Finding critical adjacent reads..." });
    console.log("[Enrichment] Agent 5/5: Due Diligence Reads — finding adjacent reads...");

    return { anthropicRequest: request, progress };
  }

  // Step 4: DD Reads complete → Liquid Token Research (if applicable) or finish
  if (session.step === 4) {
    let validReads: AdjacentRead[] = [];
    try {
      const parsed = parseJson(responseText);
      const adjacentReads = Array.isArray(parsed.adjacentReads) ? parsed.adjacentReads : [];
      validReads = adjacentReads
        .filter((r: any) => r && r.title && r.url && r.url.startsWith("http"))
        .slice(0, 5)
        .map((r: any) => ({
          title: r.title || "",
          url: r.url || "",
          source: r.source || "",
          relevance: r.relevance || "",
        }));
    } catch (err) {
      console.warn("[Enrichment] DD Reads parsing failed, continuing without adjacent reads:", err);
    }

    console.log(`[Enrichment] Due Diligence Reads: found ${validReads.length} adjacent reads`);
    progress.push({ type: "stage_complete", agent: "dd_reads", step: 5, total: totalSteps, readsFound: validReads.length });

    session.verifiedData._adjacentReads = validReads;
    session.step = 5;

    return finishEnrichmentSession(session, validReads, progress);
  }

  throw new Error("Session already completed");
}

function finishEnrichmentSession(
  session: EnrichmentSession,
  validReads: AdjacentRead[],
  progress: any[],
): { result: EnrichmentResult; progress: any[] } {
  const enrichedOutput = validateOutput(session.verifiedData);
  enrichedOutput.adjacentReads = validReads;

  if (session.tokenIdentification?.hasLiquidToken) {
    enrichedOutput.hasLiquidToken = true;
    enrichedOutput.tokenTier = session.tokenIdentification.tokenTier;
    enrichedOutput.tokenTicker = session.tokenIdentification.tokenTicker;
    enrichedOutput.tokenContractAddress = session.tokenIdentification.contractAddress;
    enrichedOutput.tokenChain = session.tokenIdentification.chain;

    if (!enrichedOutput.tags.includes("Liquid Token")) {
      enrichedOutput.tags.push("Liquid Token");
    }

    if (enrichedOutput.stage !== "Liquid Token" && STAGES.includes("Liquid Token")) {
      enrichedOutput.stage = "Liquid Token";
    }
  }

  const apiCost = session.mppCost;
  const totalCharge = calculateChargeAmount(apiCost);
  recordEnrichmentCost(apiCost);
  console.log(`[Enrichment] Token usage: ${session.usage.inputTokens} in / ${session.usage.outputTokens} out | MPP cost: $${apiCost.toFixed(6)} | Charge (1.5x): $${totalCharge.toFixed(6)}`);
  console.log("[Enrichment] Pipeline complete.");

  const result: EnrichmentResult = {
    enriched: enrichedOutput,
    apiCost,
    totalCharge,
    tokenUsage: { ...session.usage },
  };

  sessions.delete(session.id);
  return { result, progress };
}

// ─── NEXT STEPS ──────────────────────────────────────────────────────────────

export interface NextStepItem {
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
  category: "research" | "outreach" | "diligence" | "relationship" | "action";
  verified?: boolean;
  verifierNote?: string;
}

export interface NextStepsResult {
  steps: NextStepItem[];
  apiCost: number;
  totalCharge: number;
  inputTokens: number;
  outputTokens: number;
}

export function startNextStepsSession(context: {
  userId: string;
  companyId: string;
  company: {
    name: string;
    oneLiner: string | null;
    description: string | null;
    sector: string | null;
    businessModel: string | null;
    stage: string | null;
    fundingHistory: string | null;
    competitiveLandscape: string | null;
    sourceUrl: string | null;
    websiteUrl: string | null;
    githubUrl: string | null;
    twitterUrl: string | null;
    linkedinUrl: string | null;
    pipelineStage: string;
    tags: string[] | null;
  };
  founders: Array<{
    name: string;
    role: string | null;
    linkedinUrl: string | null;
    twitterUrl: string | null;
    githubUrl: string | null;
    personalUrl: string | null;
    priorCompanies: string | null;
  }>;
  notes: Array<{ content: string; createdAt: Date | string }>;
}): { sessionId: string; anthropicRequest: AnthropicRequest } {
  const { company, founders, notes } = context;

  const filledFields: string[] = [];
  const missingFields: string[] = [];
  for (const [label, val] of [
    ["description", company.description],
    ["sector", company.sector],
    ["business model", company.businessModel],
    ["stage", company.stage],
    ["funding history", company.fundingHistory],
    ["competitive landscape", company.competitiveLandscape],
    ["website URL", company.websiteUrl],
    ["LinkedIn URL", company.linkedinUrl],
    ["Twitter URL", company.twitterUrl],
    ["GitHub URL", company.githubUrl],
  ] as const) {
    if (val && val.trim()) filledFields.push(label);
    else missingFields.push(label);
  }

  const founderSummary = founders.length > 0
    ? founders.map((f) => {
        const contacts = [
          f.linkedinUrl && "LinkedIn",
          f.twitterUrl && "Twitter",
          f.githubUrl && "GitHub",
          f.personalUrl && "personal site",
        ].filter(Boolean);
        return `${f.name} (${f.role || "role unknown"})${f.priorCompanies ? `, previously at ${f.priorCompanies}` : ""}${contacts.length > 0 ? `, has: ${contacts.join(", ")}` : ", no contact info on file"}`;
      }).join("; ")
    : "No founders on record.";

  const recentNotes = notes.slice(0, 5).map((n) => n.content).join("\n---\n");

  let sourceContext = "";
  if (company.sourceUrl) {
    const url = company.sourceUrl.toLowerCase();
    if (url.includes("twitter.com") || url.includes("x.com")) sourceContext = `Discovered via Twitter/X profile: ${company.sourceUrl}`;
    else if (url.includes("linkedin.com")) sourceContext = `Discovered via LinkedIn: ${company.sourceUrl}`;
    else if (url.includes("github.com")) sourceContext = `Discovered via GitHub: ${company.sourceUrl}`;
    else if (url.includes("producthunt.com")) sourceContext = `Discovered via Product Hunt: ${company.sourceUrl}`;
    else sourceContext = `Discovered via: ${company.sourceUrl}`;
  }

  const prompt = `You are a senior VC associate advising a partner on what to do next with a specific deal. Generate 4-6 highly specific, actionable next steps for this deal based on ALL the context below. Every step must reference specific details from this company — names, numbers, claims, URLs, gaps. Never give generic advice.

DEAL CONTEXT:
- Company: ${company.name}
- One-liner: ${company.oneLiner || "N/A"}
- Pipeline stage: ${company.pipelineStage}
- Sector: ${company.sector || "Unknown"}
- Business model: ${company.businessModel || "Unknown"}
- Funding stage: ${company.stage || "Unknown"}
${sourceContext ? `- ${sourceContext}` : ""}
- Tags: ${company.tags?.join(", ") || "none"}

PROFILE COMPLETENESS:
- Filled: ${filledFields.join(", ") || "none"}
- Missing: ${missingFields.join(", ") || "none — profile is complete"}

DESCRIPTION:
${company.description || "No description available."}

FUNDING HISTORY:
${company.fundingHistory || "No funding history on record."}

COMPETITIVE LANDSCAPE:
${company.competitiveLandscape || "Not mapped yet."}

FOUNDERS:
${founderSummary}

RECENT NOTES (${notes.length} total):
${recentNotes || "No notes yet."}

AVAILABLE LINKS:
${[
  company.websiteUrl && `Website: ${company.websiteUrl}`,
  company.githubUrl && `GitHub: ${company.githubUrl}`,
  company.twitterUrl && `Twitter: ${company.twitterUrl}`,
  company.linkedinUrl && `LinkedIn: ${company.linkedinUrl}`,
].filter(Boolean).join("\n") || "No links on file."}

INSTRUCTIONS:
- Each step must be SPECIFIC to ${company.name} — mention actual founder names, actual claimed metrics, actual competitors, actual URLs
- If data is missing, say exactly what to look for and where (e.g., "Check ${company.name}'s Crunchbase profile for Series A details" not "Research funding history")
- If founders have contact info, reference the specific channel (e.g., "DM ${founders[0]?.name || "the founder"} on Twitter at ${founders[0]?.twitterUrl || "their handle"}")
- Reference the source of discovery in outreach suggestions
- For diligence stages, reference specific claims from the description that need verification
- Prioritize: what's the single most impactful thing to do RIGHT NOW given this stage?

Respond with a JSON array of objects. Each object has:
- "title": short action title (5-8 words, specific to this company)
- "detail": 1-2 sentences with specific details, names, URLs, metrics from this deal
- "priority": "high", "medium", or "low"
- "category": "research", "outreach", "diligence", "relationship", or "action"

Return ONLY the JSON array, no markdown fencing.`;

  const session: NextStepsSession = {
    id: crypto.randomUUID(),
    type: "next-steps",
    userId: context.userId,
    companyId: context.companyId,
    step: 0,
    dealContext: { company, founders, notes, filledFields, missingFields, founderSummary, sourceContext },
    usage: { inputTokens: 0, outputTokens: 0 },
    mppCost: 0,
    createdAt: Date.now(),
  };
  sessions.set(session.id, session);

  const request = buildAnthropicRequest("", prompt, false, 1500);
  delete request.system;

  console.log(`[NextSteps] Session started for ${company.name}`);
  return { sessionId: session.id, anthropicRequest: request };
}

export function advanceNextStepsSession(
  sessionId: string,
  userId: string,
  responseText: string,
  responseUsage?: { input_tokens: number; output_tokens: number },
  mppCost?: number,
): { anthropicRequest?: AnthropicRequest; result?: NextStepsResult } {
  const session = sessions.get(sessionId);
  if (!session || session.type !== "next-steps") throw new Error("Invalid or expired session");
  if (session.userId !== userId) throw new Error("Session access denied");

  if (responseUsage) {
    session.usage.inputTokens += responseUsage.input_tokens;
    session.usage.outputTokens += responseUsage.output_tokens;
  }
  if (mppCost && mppCost > 0) {
    session.mppCost += mppCost;
  }

  if (session.step === 0) {
    const cleaned = responseText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const rawSteps = JSON.parse(cleaned) as NextStepItem[];
    const validSteps = rawSteps.filter((s) => s.title && s.detail && s.priority && s.category);

    if (validSteps.length === 0) {
      const apiCost = session.mppCost;
      sessions.delete(sessionId);
      return { result: { steps: [], apiCost, totalCharge: calculateChargeAmount(apiCost), inputTokens: session.usage.inputTokens, outputTokens: session.usage.outputTokens } };
    }

    session.generatedSteps = validSteps;
    session.step = 1;

    const { company, founders, notes, filledFields, missingFields, founderSummary, sourceContext } = session.dealContext;
    const stepsJson = JSON.stringify(validSteps, null, 2);

    const verifyPrompt = `You are a quality assurance agent reviewing recommended next steps for a VC deal. Your job is to verify each step is factually grounded, actionable, and appropriate given the ACTUAL deal data below. You must catch hallucinations, incorrect assumptions, and steps that contradict the available data.

ACTUAL DEAL DATA (ground truth):
- Company: ${company.name}
- Pipeline stage: ${company.pipelineStage}
- Sector: ${company.sector || "UNKNOWN"}
- Business model: ${company.businessModel || "UNKNOWN"}
- Funding stage: ${company.stage || "UNKNOWN"}
${sourceContext ? `- ${sourceContext}` : "- Source: UNKNOWN"}

- Profile filled fields: ${filledFields.join(", ") || "none"}
- Profile missing fields: ${missingFields.join(", ") || "none"}

- Description: ${company.description || "NONE"}
- Funding history: ${company.fundingHistory || "NONE"}
- Competitive landscape: ${company.competitiveLandscape || "NONE"}

- Founders: ${founderSummary}
- Notes count: ${notes.length}
${notes.length > 0 ? `- Recent notes: ${notes.slice(0, 3).map((n: any) => n.content).join(" | ")}` : ""}

- Available links: ${[
    company.websiteUrl && `Website: ${company.websiteUrl}`,
    company.githubUrl && `GitHub: ${company.githubUrl}`,
    company.twitterUrl && `Twitter: ${company.twitterUrl}`,
    company.linkedinUrl && `LinkedIn: ${company.linkedinUrl}`,
  ].filter(Boolean).join(", ") || "NONE"}

PROPOSED STEPS TO VERIFY:
${stepsJson}

For EACH step, check:
1. FACTUAL ACCURACY: Does it reference real data from the deal? If it mentions a founder name, URL, metric, or claim — is that actually in the data above?
2. CONTRADICTIONS: Does it suggest doing something that's already done? (e.g., "find the website" when websiteUrl exists, or "identify founders" when founders are on record)
3. STAGE APPROPRIATENESS: Is this step appropriate for the "${company.pipelineStage}" pipeline stage? Don't suggest outreach at discovery or research at invested.
4. ACTIONABILITY: Is the step specific enough to act on, or is it vague/generic?
5. HALLUCINATED DETAILS: Does the step mention URLs, names, numbers, or facts NOT present in the deal data above?

Respond with a JSON array. For each ORIGINAL step, include:
- All original fields (title, detail, priority, category)
- "verified": true if the step passes ALL checks, false if it fails any
- "verifierNote": Brief explanation of what was checked or why it failed (always include this)
- If a step has minor issues but is salvageable, set verified=true and fix the detail text to remove hallucinated specifics
- If a step is fundamentally wrong (contradicts data, wrong stage, entirely hallucinated), set verified=false

Return ONLY the JSON array, no markdown fencing.`;

    const request = buildAnthropicRequest("", verifyPrompt, false, 2000);
    delete request.system;

    console.log(`[NextSteps] Stage 2/2: Verifying ${validSteps.length} recommendations...`);
    return { anthropicRequest: request };
  }

  if (session.step === 1) {
    const cleaned = responseText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const verifiedSteps = JSON.parse(cleaned) as NextStepItem[];

    const passed = verifiedSteps.filter((s) => s.verified !== false);
    const failed = verifiedSteps.filter((s) => s.verified === false);

    if (failed.length > 0) {
      console.log(`[NextSteps] Verifier rejected ${failed.length} step(s):`);
      for (const f of failed) {
        console.log(`  - "${f.title}": ${f.verifierNote}`);
      }
    }

    const steps = passed.map((s) => ({
      title: s.title,
      detail: s.detail,
      priority: s.priority,
      category: s.category,
      verified: true as const,
      verifierNote: s.verifierNote,
    }));

    const apiCost = session.mppCost;
    console.log(`[NextSteps] Pipeline complete. ${steps.length} verified steps. MPP cost: $${apiCost.toFixed(6)}`);

    sessions.delete(sessionId);
    return {
      result: {
        steps,
        apiCost,
        totalCharge: calculateChargeAmount(apiCost),
        inputTokens: session.usage.inputTokens,
        outputTokens: session.usage.outputTokens,
      },
    };
  }

  throw new Error("Session already completed");
}

// ─── DEEP RESEARCH ───────────────────────────────────────────────────────────

export interface DeepResearchResult {
  content: string;
  apiCost: number;
  totalCharge: number;
  inputTokens: number;
  outputTokens: number;
}

export const DEEP_RESEARCH_SYSTEM = `You are a Deep Research Agent producing investment-grade research reports for venture capital investors. You have web search access and must use it extensively.

Your goal: Take all known information about a company/project (deal card data, founder info, notes) and conduct deep, independent research to produce a comprehensive Markdown research document.

## CRITICAL OUTPUT RULE

Your output must contain ONLY the final Markdown report. Do NOT include any narration about your search process, thinking, or intermediate observations. No "I'll search for...", "Let me look into...", "Good, I found...", or any other commentary. The output starts with the title and ends with the conclusion. Nothing else.

## Phase 1: Information Gathering (Web Search)

Run 5–8 sequential web searches, each targeting a different angle of the project. The searches should be layered intentionally — broad first, then increasingly specific as you learn more about what the project actually is.

**Search sequence:**
1. Fetch the company's website/URL directly — get the primary source content, what the project says about itself
2. Broad discovery — what category is this, who's talking about it, press coverage
3. Team/founders — background, credibility, track record, prior exits
4. Product mechanics — pricing, features, rules, technical architecture, specific tiers/plans/pricing
5. Third-party coverage — reviews, community sentiment, analyst takes
6. Business model deep dive — revenue streams, unit economics, growth metrics
7. Competitive landscape — search by category (not by name) to surface the real landscape
8. Recent developments — latest news, partnerships, hiring signals
9. Use quoted exact phrases for specificity when earlier searches return too much noise

**Key search principles:**
- **Start with the project's own site** — the project's self-description reveals what they think their value prop is
- **Search for the team/backers separately** — the project page often buries or overstates backer involvement. Independent searches surface the real relationship
- **Search for the token separately from the product** — tokenomics and product quality are independent variables. Don't conflate them
- **Search for competitors by category, not by name** — searching the category surfaces the competitive landscape better than searching for specific competitors
- **Use quoted exact phrases** for specificity when earlier searches return too much noise

**What to extract from each search:**
- Core product description and mechanics
- Team background and credibility signals
- Backer names, involvement depth, and distribution potential
- Token structure, FDV, supply, allocation, vesting
- Competitive positioning — who else does this, what's different
- Traction metrics — users, volume, payouts, TVL, social following
- Red flags — rule changes, payout complaints, regulatory issues
- Roadmap items — what's live vs. coming soon vs. vaporware

## Phase 2: Report Structure (Markdown)

Once you have search results ingested, organize the research into the following standard framework. Don't use every search result — most are noise. Focus on the 15–20 genuinely informative data points.

Produce a well-structured Markdown document. The output MUST follow this exact structure:

# [Company Name] — Deep Research Report

[One-line descriptor of what the company is]

[Company URL if known]

[Key builder/backer/platform line, e.g. "Built by X | Backed by Y | Powered by Z"]

## Executive Summary
- What it is (one paragraph — be specific about what the product does, not vague)
- Why it matters / core thesis (one paragraph — what industry problem does this solve and why now)
- Key numbers and upcoming catalysts (one paragraph — specific metrics, funding details, timeline)

## Product Overview

Break this into detailed subsections with h3 headers. Do NOT summarize — go deep.

### Core Product
- How the product actually works end-to-end. Walk through the user flow.
- If there are tiers/plans/challenge types, list them ALL in a table with every parameter (pricing, limits, splits, rules)
- Be specific about numbers: how many assets, what categories, what limits

### Asset Universe / Scope
- What can users actually access? List categories and counts.

### UX, Tooling & Technical Architecture
- What's the interface like? Custom-built or third-party?
- List specific tools, features, and capabilities individually
- If they have unique technical features, give each its own description

### Additional Products / Roadmap
- Any secondary products or tools (give each its own subsection if substantial)
- What's live vs. coming soon — use a status table:
  | Feature | Status |
  |---------|--------|
  | Feature A | ✅ Live |
  | Feature B | ⏳ Coming Soon (Q2 2026) |
  | Feature C | ⏳ Listed, no ship date |

## Business Model & Economics

### Revenue Streams
- List EACH revenue stream separately with explanation (not just "fees")
- Challenge fees, profit retention %, token-linked revenue, etc.

### On-Chain / Technical Execution Model
- How does execution work technically? What infrastructure do they use?
- What are the structural implications of this choice?

### Unit Economics
- Industry context for the business model — what are typical pass rates, retention rates, etc.?
- Structural advantages AND disadvantages of the model

## Team & Backers

### [Team/Studio Name] (Builder)
- Detailed background on the building team/studio
- What did they build before? Is there domain expertise or is this a pivot?
- If it's a pivot, explicitly note the domain gap and what it means

### [Backer Name] (Backer)
- Nature of backing — equity investment, strategic partnership, advisory, or just branding?
- Don't take "backed by X" at face value — investigate the actual depth of involvement
- Quantify the backer (AUM, users, funding history)

### Build-in-Public / Community Signals
- Social metrics (Twitter followers, Discord size, community engagement)
- Transparency practices (public changelogs, streams, open development)

## Token Economics
(Include this section if applicable — crypto projects, token-based models, etc.)

### [Token Name] Token Parameters
Use a table:
| Parameter | Details |
|-----------|---------|
| Token | $TICKER |
| Raise | $X |
| FDV | $X |
| ... | ... |

### Token Distribution
- Break down ALL known allocations with percentages
- Flag any unusual unlock schedules (e.g., 100% unlocked at TGE is unusual — call it out)

### Value Flow Analysis
- How does revenue flow from the product to the token?
- Walk through the chain step by step (product → studio → buyback → token)
- If there's a dual-token structure, explain the relationship and implications

### Staking Mechanics
- APY, lock periods, reward structure
- Flag if APY is denominated in an unlaunched token (that's not real yield)

## Competitive Landscape

### Traditional / Established Competitors
- Name them individually, compare in a table if possible
- Include: founded year, backing, key metrics, profit split, differentiators

### Crypto-Native / Direct Competitors
- Same level of detail as above
- First-mover advantages and how quickly the moat could narrow

### Competitive Advantages
- List each advantage as a bullet with specific explanation

### Competitive Risks
- List each risk as a bullet — be equally honest as the advantages section

## Key Metrics & Traction
Use a markdown table with every hard number you found. Include context for what the numbers mean relative to industry benchmarks.

| Metric | Value |
|--------|-------|
| ... | ... |

After the table, provide 1-2 paragraphs of context comparing these metrics to industry standards.

## Risk Analysis

Each risk gets its own subsection with a paragraph of analysis, not just a bullet point:

### Platform/Dependency Risk
[Full paragraph explaining the specific dependency, what could go wrong, and historical precedent]

### Regulatory Risk
[Full paragraph]

### Team Execution Risk
[Full paragraph — especially important if team is pivoting from a different domain]

### Token/Dilution Risk
[Full paragraph]

### Market Sizing Reality Check
[Full paragraph — challenge the stated TAM if needed]

## Investment Considerations

### Bull Case
- 4-5 specific bullets, each steelmanned with reasoning

### Bear Case
- 4-5 specific bullets, each steelmanned EQUALLY with reasoning. This is not an afterthought.

## Conclusion
- Net assessment (one paragraph)
- Key open questions for further diligence (bullet list of 3-5 specific questions)
- What metric to watch going forward

---

## Critical Rules
- **Product before token** — always understand what the thing does before analyzing the token. Too many crypto reports lead with tokenomics
- **Separate what's live from what's roadmap** — clearly flag features that are "coming soon" vs. actually shipped
- **Bull and bear cases get equal weight** — if the bull case is 5 bullets, the bear case is 5 bullets. This is not marketing material
- **Risk section is mandatory** — even if the project looks great, every project has risks. Omitting them is dishonest
- **Use tables for data, prose for analysis** — numbers go in tables. Opinions and reasoning go in paragraphs. Don't mix them
- **Be specific** — name competitors, cite sources, give numbers
- **Go deep, not wide** — each section should have detailed subsections (h3 headers). A shallow overview is not acceptable. Write PARAGRAPHS of analysis, not just bullet lists
- **Each risk gets a full paragraph** — not a one-liner. Explain the specific mechanism, historical precedent, and severity

## Calibration

**Things you must deliberately do:**
- Cross-reference the project's claims against independent sources (e.g., if they say "$1.2M in payouts," look for third-party confirmation)
- Flag when a number is self-reported vs. independently verified
- Note when a team's background doesn't match the product domain
- Call out vaporware explicitly ("this feature is listed as coming soon with no shipping date")
- Compare FDV/valuation to comparable projects at similar stages
- Investigate the actual depth of backer involvement — don't just list logos
- Break down product tiers/plans into full comparison tables
- Give each unique tool/feature its own description rather than lumping them together

**Things you must deliberately avoid:**
- Price predictions or "should you invest" recommendations
- Taking the project's marketing framing at face value
- Ignoring the bear case because the bull case is exciting
- Treating token airdrop APY as "real yield" when the token doesn't exist yet
- Assuming backers = endorsement (backing can mean many things)
- Hallucination — if you can't find information, say "not publicly available" rather than guessing
- Narrating your search process in the output — no "I'll search for...", "Let me look into...", etc.
- Writing shallow bullet-only sections — use prose paragraphs with analysis, supported by tables for data`;

function stripSearchNarration(content: string): string {
  const reportStart = content.match(/^(#+\s+.+)/m);
  if (reportStart && reportStart.index && reportStart.index > 0) {
    const before = content.substring(0, reportStart.index).trim();
    if (!before.startsWith("#")) {
      content = content.substring(reportStart.index);
    }
  }

  content = content.replace(/^(?:I'll|I will|Let me|Good,|Now |Great,|OK,|Alright,|First,|Next,|Finally,).*\n?/gm, "");
  content = content.replace(/\n{3,}/g, "\n\n");

  return content.trim();
}

export type ReportProgressCallback = (stage: string, detail: string) => void;

export function startDeepResearchSession(
  userId: string,
  companyId: string,
  reportId: string,
  company: { name: string; oneLiner: string; description?: string | null; sector?: string | null; subSector?: string | null; businessModel?: string | null; stage?: string | null; fundingHistory?: string | null; competitiveLandscape?: string | null; sourceUrl?: string | null; websiteUrl?: string | null; githubUrl?: string | null; twitterUrl?: string | null; linkedinUrl?: string | null; },
  founders: { name: string; role?: string | null; bio?: string | null; linkedinUrl?: string | null; twitterUrl?: string | null; priorCompanies?: string | null }[],
  notes: { content: string }[],
  previouslyDeletedCount: number = 0,
): { sessionId: string; anthropicRequest: AnthropicRequest } {
  const contextParts = [
    `Company: ${company.name}`,
    `One-liner: ${company.oneLiner}`,
    company.description ? `Description: ${company.description}` : null,
    company.sector ? `Sector: ${company.sector}` : null,
    company.subSector ? `Sub-sector: ${company.subSector}` : null,
    company.businessModel ? `Business Model: ${company.businessModel}` : null,
    company.stage ? `Stage: ${company.stage}` : null,
    company.fundingHistory ? `Funding History: ${company.fundingHistory}` : null,
    company.competitiveLandscape ? `Known Competitive Landscape: ${company.competitiveLandscape}` : null,
    company.websiteUrl ? `Website: ${company.websiteUrl}` : null,
    company.sourceUrl ? `Source URL: ${company.sourceUrl}` : null,
    company.githubUrl ? `GitHub: ${company.githubUrl}` : null,
    company.twitterUrl ? `Twitter: ${company.twitterUrl}` : null,
    company.linkedinUrl ? `LinkedIn: ${company.linkedinUrl}` : null,
  ].filter(Boolean).join("\n");

  const founderContext = founders.length > 0
    ? "\n\nKnown Founders/Team:\n" + founders.map((f) =>
        [f.name, f.role, f.bio, f.linkedinUrl, f.twitterUrl, f.priorCompanies].filter(Boolean).join(" | ")
      ).join("\n")
    : "";

  const notesContext = notes.length > 0
    ? "\n\nInvestor Notes:\n" + notes.map((n) => `- ${n.content}`).join("\n")
    : "";

  const regenerationContext = previouslyDeletedCount > 0
    ? `\n\nIMPORTANT: The investor has previously generated and deleted ${previouslyDeletedCount} report${previouslyDeletedCount > 1 ? "s" : ""} on this company because the quality was not satisfactory. This time you MUST produce a significantly better report. Conduct more thorough research (use all available search attempts), dig deeper into each section, find more specific data points and metrics, provide stronger cross-referencing of claims, and deliver more nuanced analysis. The bar is higher — the previous report${previouslyDeletedCount > 1 ? "s were" : " was"} not good enough.`
    : "";

  const userMessage = `Here is everything we currently know about this company from our deal pipeline. Use this as a starting point, then conduct extensive independent research using web search to produce a comprehensive deep research report in Markdown format.

${contextParts}${founderContext}${notesContext}${regenerationContext}

Produce the full Markdown research document now. Use web search extensively to find information beyond what's provided above. Cross-reference all claims.`;

  const session: DeepResearchSession = {
    id: crypto.randomUUID(),
    type: "deep-research",
    userId,
    companyId,
    reportId,
    usage: { inputTokens: 0, outputTokens: 0 },
    mppCost: 0,
    createdAt: Date.now(),
  };
  sessions.set(session.id, session);

  const phase1Request = buildAnthropicRequest(
    DEEP_RESEARCH_SYSTEM,
    `${userMessage}\n\nPHASE 1 INSTRUCTIONS: Focus on information gathering. Conduct extensive web searches to research this company/project. Cover: product mechanics, team/founders background, business model, traction metrics, and recent developments. Compile your findings as detailed research notes organized by topic. Do NOT write the final report yet — just gather and organize the raw research.`,
    true, 6000, 10,
  );

  const phase2Request = buildAnthropicRequest(
    DEEP_RESEARCH_SYSTEM,
    `Continue researching "${company.name}". PHASE 2 INSTRUCTIONS: Focus on competitive landscape, token economics (if applicable), risk analysis, and investment considerations. Search for: competitors by category (not by name), regulatory landscape, market sizing, and any red flags or concerns. Compile findings as detailed research notes. Do NOT write the final report yet.`,
    true, 6000, 10,
  );

  console.log(`[DeepResearch] Session started for ${company.name} (multi-turn: 3 phases)`);
  return {
    sessionId: session.id,
    anthropicRequest: phase1Request,
    phase2Request,
    userMessage,
  };
}

export function completeDeepResearchSession(
  sessionId: string,
  userId: string,
  responseText: string,
  responseUsage?: { input_tokens: number; output_tokens: number },
  mppCost?: number,
): DeepResearchResult {
  const session = sessions.get(sessionId);
  if (!session || session.type !== "deep-research") throw new Error("Invalid or expired session");
  if (session.userId !== userId) throw new Error("Session access denied");

  if (responseUsage) {
    session.usage.inputTokens += responseUsage.input_tokens;
    session.usage.outputTokens += responseUsage.output_tokens;
  }
  if (mppCost && mppCost > 0) {
    session.mppCost += mppCost;
  }

  let reportContent = responseText;
  if (!reportContent.trim()) {
    throw new Error("Deep research agent returned no content");
  }

  reportContent = stripSearchNarration(reportContent);

  const apiCost = session.mppCost;
  console.log(`[DeepResearch] Complete. MPP cost: $${apiCost.toFixed(6)}`);

  sessions.delete(sessionId);
  return {
    content: reportContent,
    apiCost,
    totalCharge: calculateChargeAmount(apiCost),
    inputTokens: session.usage.inputTokens,
    outputTokens: session.usage.outputTokens,
  };
}
