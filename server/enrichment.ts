import Anthropic from "@anthropic-ai/sdk";
import { scrapeUrl, scrapeMultiple, type ScrapedContent } from "./scraper";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

export interface EnrichedCompany {
  name: string;
  oneLiner: string;
  description: string;
  sector: string;
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

const STAGES = ["Pre-seed", "Seed", "Series A", "Series B", "Growth", "Public"];

async function callAgent(systemPrompt: string, userMessage: string, useWebSearch: boolean = false): Promise<string> {
  const options: any = {
    model: "claude-opus-4-6",
    max_tokens: 16000,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  };

  if (useWebSearch) {
    options.tools = [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 10,
      },
    ];
  }

  const message = await anthropic.messages.create(options);

  let textContent = "";
  for (const block of message.content) {
    if (block.type === "text") {
      textContent += block.text;
    }
  }

  if (!textContent) throw new Error("No text content in AI response");
  return textContent;
}

function parseJson(text: string): any {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) cleaned = fenceMatch[1];
  return JSON.parse(cleaned);
}

// ─── AGENT 1: IDENTIFIER ────────────────────────────────────────────────────
// Figures out WHICH company is being referenced from any input

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

async function runIdentifierAgent(input: string, scrapedContent?: ScrapedContent[]): Promise<{
  companyName: string;
  domain: string;
  confidence: string;
  reasoning: string;
}> {
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
  const result = await callAgent(IDENTIFIER_SYSTEM, prompt, true);
  return parseJson(result);
}

// ─── AGENT 2: RESEARCH ──────────────────────────────────────────────────────
// Deep research on the identified company

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

For founders: ONLY list founders you are confident about. Use web search to find their real LinkedIn, Twitter/X, and GitHub profiles. Only include URLs you have actually verified exist via web search.

For competitive landscape: Only list companies that genuinely compete in the same space.

IMPORTANT: Use web search to find the company's REAL URLs:
- Official website URL
- GitHub organization URL (if they have one)
- Twitter/X profile URL
- LinkedIn company page URL
- For each founder: their LinkedIn, Twitter/X, GitHub, and personal website URLs

Return ONLY valid JSON matching this schema:
{
  "name": "Company name",
  "oneLiner": "What they do in one sentence",
  "description": "2-3 paragraph description",
  "sector": "One of: ${SECTORS.join(", ")}",
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
      "role": "Title",
      "bio": "Only confirmed background info",
      "linkedinUrl": "Verified LinkedIn profile URL or empty string",
      "twitterUrl": "Verified Twitter/X profile URL or empty string",
      "githubUrl": "Verified GitHub profile URL or empty string",
      "personalUrl": "Verified personal website URL or empty string",
      "priorCompanies": "Only confirmed prior companies"
    }
  ],
  "confidenceNotes": {
    "highConfidence": ["list of fields you are very confident about"],
    "mediumConfidence": ["fields with moderate confidence"],
    "lowConfidence": ["fields you are less sure about"]
  }
}`;

async function runResearchAgent(companyName: string, domain: string, originalInput: string, scrapedContent?: ScrapedContent[]): Promise<any> {
  let prompt = `Research this company thoroughly:
Company: ${companyName}
Domain: ${domain || "unknown"}
Original input that led to identification: ${originalInput}

Produce the comprehensive deal card. Remember: accuracy over completeness. Leave fields empty if unsure.`;

  if (scrapedContent && scrapedContent.length > 0) {
    prompt += `\n\n--- REAL SCRAPED WEB CONTENT ---\nThe following content was fetched directly from web pages. This is REAL data — use it as your PRIMARY source of truth. Prefer information found here over your training data.\n`;
    for (const sc of scrapedContent) {
      if (!sc.fetchedSuccessfully) continue;
      prompt += `\n[URL: ${sc.url}]\nTitle: ${sc.title}\nMeta Description: ${sc.metaDescription}\n`;
      if (sc.linkedWebsite) prompt += `Linked Website: ${sc.linkedWebsite}\n`;
      if (sc.ogData["og:site_name"]) prompt += `Site Name: ${sc.ogData["og:site_name"]}\n`;
      prompt += `Body text:\n${sc.bodyText.slice(0, 3000)}\n`;
      if (sc.links.length > 0) prompt += `Outbound links: ${sc.links.slice(0, 15).join(", ")}\n`;
    }
  }

  const result = await callAgent(RESEARCH_SYSTEM, prompt, true);
  return parseJson(result);
}

// ─── AGENT 3: VERIFY & CLEAN ────────────────────────────────────────────────
// Combined fact-checker + hallucination firewall in a single pass

const VERIFY_AND_CLEAN_SYSTEM = `You are the Verify & Clean Agent — the final quality gate in a VC deal intelligence pipeline. You receive a research draft about a company and must:
1. VERIFY: Rigorously fact-check every claim in the draft
2. CLEAN: Produce the final deal card with all unverified/hallucinated content removed

YOU HAVE WEB SEARCH ACCESS. Use it to independently verify claims. Search for the company, its funding rounds, founders, and competitors to cross-check the information.

VERIFICATION FOCUS — pay EXTRA attention to:
- Funding amounts and dates (commonly hallucinated)
- Investor names (commonly hallucinated)
- Founder bios and prior companies (commonly embellished)
- LinkedIn/Twitter URLs (almost always hallucinated — verify format and existence)
- Company stage (often guessed incorrectly)
- Specific metrics or user numbers (commonly fabricated)

CLEANING RULES — your output must be squeaky clean:
- REMOVE any claim you cannot verify — set to empty string or remove from array
- URLs (website, GitHub, Twitter, LinkedIn) → KEEP only if verified or follows correct platform format. REMOVE if fabricated.
- Funding amounts → remove specific dollar amounts unless verified; keep only what's confirmed
- Founder bios → strip any unverified claims about education, roles, or achievements
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

async function runVerifyAndCleanAgent(companyName: string, researchDraft: any): Promise<{ cleaned: EnrichedCompany; issuesFound: number; assessment: string }> {
  const prompt = `Verify and clean this research draft about "${companyName}".

RESEARCH DRAFT:
${JSON.stringify(researchDraft, null, 2)}

Step 1: Use web search to independently verify the key claims — funding, founders, URLs, metrics.
Step 2: Produce the final clean deal card JSON with all unverified or hallucinated content stripped out. When in doubt, OMIT.`;
  const result = await callAgent(VERIFY_AND_CLEAN_SYSTEM, prompt, true);
  const parsed = parseJson(result);
  const summary = parsed.verificationSummary || {};
  const issuesFound = (summary.removed?.length || 0) + (summary.revised?.length || 0);
  const assessment = summary.overallAssessment || "clean";
  return { cleaned: parsed, issuesFound, assessment };
}

// ─── PIPELINE ORCHESTRATOR ──────────────────────────────────────────────────

function sanitizeUrl(url: any, expectedDomain?: string): string {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return "";
  if (expectedDomain) {
    try {
      const hostname = new URL(trimmed).hostname.replace("www.", "");
      if (!hostname.includes(expectedDomain)) return "";
    } catch { return ""; }
  }
  return trimmed;
}

function validateOutput(data: any): EnrichedCompany {
  const result: EnrichedCompany = {
    name: data.name || "",
    oneLiner: data.oneLiner || "",
    description: data.description || "",
    sector: SECTORS.includes(data.sector) ? data.sector : "",
    businessModel: BUSINESS_MODELS.includes(data.businessModel) ? data.businessModel : "",
    stage: STAGES.includes(data.stage) ? data.stage : "",
    fundingHistory: data.fundingHistory || "",
    competitiveLandscape: data.competitiveLandscape || "",
    websiteUrl: sanitizeUrl(data.websiteUrl),
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
        linkedinUrl: sanitizeUrl(f.linkedinUrl, "linkedin.com"),
        twitterUrl: sanitizeUrl(f.twitterUrl, "x.com") || sanitizeUrl(f.twitterUrl, "twitter.com"),
        githubUrl: sanitizeUrl(f.githubUrl, "github.com"),
        personalUrl: sanitizeUrl(f.personalUrl),
        priorCompanies: f.priorCompanies || "",
      }));
  }

  return result;
}

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
  emit({ type: "stage", agent: "scraper", step: 0, total: 4, message: `Fetching content from ${urls.length} URL(s)...` });
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
    emit({ type: "stage", agent: "scraper", step: 0, total: 4, message: `Found linked website — fetching company page...` });
    const additional = await scrapeMultiple(additionalUrls);
    results.push(...additional);
  }

  const totalFetched = results.filter((r) => r.fetchedSuccessfully).length;
  emit({ type: "stage_complete", agent: "scraper", step: 0, pagesFetched: totalFetched });
  console.log(`[Scraper] Total pages fetched: ${totalFetched}`);

  return results;
}

async function runPipeline(input: string, onProgress?: ProgressCallback): Promise<EnrichedCompany> {
  const emit = (data: any) => {
    if (onProgress) onProgress(data);
  };

  const scrapedContent = await scrapeInputUrls(input, onProgress);

  emit({ type: "stage", agent: "identifier", step: 1, total: 4, message: "Identifying company from input..." });
  console.log("[Enrichment] Agent 1/3: Identifier — resolving company from input...");
  const identity = await runIdentifierAgent(input, scrapedContent);
  console.log(`[Enrichment] Identified: "${identity.companyName}" (confidence: ${identity.confidence})`);
  emit({ type: "stage_complete", agent: "identifier", step: 1, companyName: identity.companyName, confidence: identity.confidence });

  if (identity.confidence === "low" && !identity.companyName) {
    throw new Error("Could not confidently identify a company from the provided input. Please try a more specific URL or company name.");
  }

  if (identity.domain && scrapedContent.every((sc) => !sc.url.includes(identity.domain))) {
    console.log(`[Scraper] Identifier found domain ${identity.domain} — fetching company website...`);
    const companySite = await scrapeUrl(`https://${identity.domain}`);
    if (companySite.fetchedSuccessfully) {
      scrapedContent.push(companySite);
      console.log(`[Scraper] Fetched company website: ${identity.domain}`);
    }
  }

  emit({ type: "stage", agent: "researcher", step: 2, total: 4, message: `Researching ${identity.companyName}...` });
  console.log("[Enrichment] Agent 2/3: Research — building deal card...");
  const researchDraft = await runResearchAgent(identity.companyName, identity.domain, input, scrapedContent);
  console.log("[Enrichment] Research draft complete.");
  emit({ type: "stage_complete", agent: "researcher", step: 2 });

  emit({ type: "stage", agent: "verify_clean", step: 3, total: 4, message: "Verifying claims & cleaning output..." });
  console.log("[Enrichment] Agent 3/3: Verify & Clean — fact-checking and producing clean output...");
  const { cleaned, issuesFound, assessment } = await runVerifyAndCleanAgent(identity.companyName, researchDraft);
  console.log(`[Enrichment] Verify & Clean: ${assessment} (${issuesFound} issues found)`);
  emit({ type: "stage_complete", agent: "verify_clean", step: 3, issuesFound, assessment });

  console.log("[Enrichment] Pipeline complete. Validated output ready.");
  return validateOutput(cleaned);
}

export interface NextStepItem {
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
  category: "research" | "outreach" | "diligence" | "relationship" | "action";
  verified?: boolean;
  verifierNote?: string;
}

export async function generateNextSteps(context: {
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
}): Promise<NextStepItem[]> {
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

  try {
    console.log(`[NextSteps] Stage 1/2: Generating recommendations for ${company.name}...`);
    const response = await anthropic.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const rawSteps = JSON.parse(cleaned) as NextStepItem[];
    const validSteps = rawSteps.filter((s) => s.title && s.detail && s.priority && s.category);

    if (validSteps.length === 0) return [];

    console.log(`[NextSteps] Stage 2/2: Verifying ${validSteps.length} recommendations...`);
    const verified = await verifyNextSteps(validSteps, {
      company, founders, notes, filledFields, missingFields, founderSummary, sourceContext,
    });
    console.log(`[NextSteps] Pipeline complete. ${verified.length} verified steps.`);
    return verified;
  } catch (error) {
    console.error("[NextSteps] AI generation failed:", error);
    return [];
  }
}

async function verifyNextSteps(
  steps: NextStepItem[],
  dealContext: {
    company: any;
    founders: any[];
    notes: any[];
    filledFields: string[];
    missingFields: string[];
    founderSummary: string;
    sourceContext: string;
  },
): Promise<NextStepItem[]> {
  const { company, founders, notes, filledFields, missingFields, founderSummary, sourceContext } = dealContext;

  const stepsJson = JSON.stringify(steps, null, 2);

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

  try {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 2000,
      messages: [{ role: "user", content: verifyPrompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const verifiedSteps = JSON.parse(cleaned) as NextStepItem[];

    const passed = verifiedSteps.filter((s) => s.verified !== false);
    const failed = verifiedSteps.filter((s) => s.verified === false);

    if (failed.length > 0) {
      console.log(`[NextSteps] Verifier rejected ${failed.length} step(s):`);
      for (const f of failed) {
        console.log(`  - "${f.title}": ${f.verifierNote}`);
      }
    }

    return passed.map((s) => ({
      title: s.title,
      detail: s.detail,
      priority: s.priority,
      category: s.category,
      verified: true,
      verifierNote: s.verifierNote,
    }));
  } catch (error) {
    console.error("[NextSteps] Verifier failed, returning unverified steps:", error);
    return steps.map((s) => ({ ...s, verified: false, verifierNote: "Verification unavailable" }));
  }
}

export async function enrichFromInput(input: string): Promise<EnrichedCompany> {
  console.log("[Enrichment] Starting 3-agent pipeline...");
  return runPipeline(input);
}

export async function enrichFromInputWithProgress(input: string, onProgress: ProgressCallback): Promise<EnrichedCompany> {
  console.log("[Enrichment] Starting 3-agent pipeline (with progress)...");
  return runPipeline(input, onProgress);
}
