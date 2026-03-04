import Anthropic from "@anthropic-ai/sdk";

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
  tags: string[];
  founders: {
    name: string;
    role: string;
    bio: string;
    linkedinUrl: string;
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

async function callAgent(systemPrompt: string, userMessage: string): Promise<string> {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });
  const content = message.content[0];
  if (content.type !== "text") throw new Error("Unexpected AI response type");
  return content.text;
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

async function runIdentifierAgent(input: string): Promise<{
  companyName: string;
  domain: string;
  confidence: string;
  reasoning: string;
}> {
  const result = await callAgent(IDENTIFIER_SYSTEM, `Identify the company from this input:\n\n${input}`);
  return parseJson(result);
}

// ─── AGENT 2: RESEARCH ──────────────────────────────────────────────────────
// Deep research on the identified company

const RESEARCH_SYSTEM = `You are the Research Agent in a VC deal intelligence pipeline. You receive a confirmed company identity and must produce a comprehensive deal card.

YOUR MANDATE:
- Only include facts you are HIGHLY CONFIDENT about.
- For anything you are uncertain about, use empty string or leave it out.
- NEVER fabricate funding amounts, investor names, dates, or LinkedIn URLs.
- If you are not sure about a founder's exact role, prior companies, or bio details, leave those fields empty rather than guessing.
- Clearly distinguish between what you KNOW vs what you're INFERRING.

For funding history: ONLY include rounds you are certain actually happened. Do NOT make up dollar amounts or investor names. If you don't know specific details, say "Details not confirmed" or leave empty.

For founders: ONLY list founders you are confident about. Do NOT guess LinkedIn URLs — leave them empty if you don't have high confidence.

For competitive landscape: Only list companies that genuinely compete in the same space.

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
  "tags": ["2-5 relevant tags"],
  "founders": [
    {
      "name": "Full name",
      "role": "Title",
      "bio": "Only confirmed background info",
      "linkedinUrl": "Only if you are certain, otherwise empty string",
      "priorCompanies": "Only confirmed prior companies"
    }
  ],
  "confidenceNotes": {
    "highConfidence": ["list of fields you are very confident about"],
    "mediumConfidence": ["fields with moderate confidence"],
    "lowConfidence": ["fields you are less sure about"]
  }
}`;

async function runResearchAgent(companyName: string, domain: string, originalInput: string): Promise<any> {
  const prompt = `Research this company thoroughly:
Company: ${companyName}
Domain: ${domain || "unknown"}
Original input that led to identification: ${originalInput}

Produce the comprehensive deal card. Remember: accuracy over completeness. Leave fields empty if unsure.`;
  const result = await callAgent(RESEARCH_SYSTEM, prompt);
  return parseJson(result);
}

// ─── AGENT 3: FACT-CHECKER ──────────────────────────────────────────────────
// Cross-checks every claim in the research output

const FACT_CHECKER_SYSTEM = `You are the Fact-Checker Agent in a VC deal intelligence pipeline. You receive a research draft about a company and must rigorously verify every claim.

YOUR JOB:
1. Review every field in the draft for factual accuracy.
2. For each claim, assess whether it's VERIFIABLE or POTENTIALLY HALLUCINATED.
3. Flag specific concerns — wrong dates, made-up funding rounds, incorrect founder info, fabricated URLs, etc.
4. Pay EXTRA attention to:
   - Funding amounts and dates (commonly hallucinated)
   - Investor names (commonly hallucinated)  
   - Founder bios and prior companies (commonly embellished)
   - LinkedIn/Twitter URLs (almost always hallucinated — flag unless obviously correct format)
   - Company stage (often guessed incorrectly)
   - Specific metrics or user numbers (commonly fabricated)

Return ONLY valid JSON:
{
  "overallAssessment": "clean" | "concerns" | "major_issues",
  "verifiedFields": ["list of field names that appear factually accurate"],
  "flaggedIssues": [
    {
      "field": "field name",
      "claim": "the specific claim being questioned",
      "concern": "why this might be inaccurate",
      "recommendation": "remove" | "revise" | "keep_with_caveat"
    }
  ],
  "suggestedRevisions": {
    "fieldName": "corrected value or empty string to clear it"
  }
}`;

async function runFactCheckerAgent(companyName: string, researchDraft: any): Promise<any> {
  const prompt = `Fact-check this research draft about "${companyName}".

DRAFT:
${JSON.stringify(researchDraft, null, 2)}

Rigorously verify every claim. Flag anything that looks potentially hallucinated, fabricated, or uncertain. Be especially suspicious of specific numbers, dates, URLs, and investor names.`;
  const result = await callAgent(FACT_CHECKER_SYSTEM, prompt);
  return parseJson(result);
}

// ─── AGENT 4: HALLUCINATION FIREWALL ────────────────────────────────────────
// Final pass that produces the clean, verified output

const FIREWALL_SYSTEM = `You are the Hallucination Firewall — the final quality gate in a VC deal intelligence pipeline. You receive:
1. The original research draft
2. The fact-checker's report with flagged issues

YOUR MANDATE is absolute: REMOVE anything that could be hallucinated. When in doubt, OMIT.

RULES:
- Any field flagged with "remove" recommendation → set to empty string (or remove from array)
- Any field flagged with "revise" → apply the suggested revision
- LinkedIn URLs → ALWAYS set to empty string unless the fact-checker explicitly verified them
- Funding amounts → remove specific dollar amounts if flagged; keep only what's verified
- Founder bios → strip any unverified claims about education, roles, or achievements
- Description → remove any specific metrics, user counts, or revenue figures unless verified
- Do NOT add any new information — only remove or revise existing content

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
  "tags": ["verified tags"],
  "founders": [
    {
      "name": "Verified name",
      "role": "Verified role or empty string",
      "bio": "Only verified bio info or empty string",
      "linkedinUrl": "empty string unless explicitly verified",
      "priorCompanies": "Only verified prior companies or empty string"
    }
  ]
}`;

async function runFirewallAgent(researchDraft: any, factCheckReport: any): Promise<EnrichedCompany> {
  const prompt = `Apply the hallucination firewall to produce a clean, verified deal card.

RESEARCH DRAFT:
${JSON.stringify(researchDraft, null, 2)}

FACT-CHECKER REPORT:
${JSON.stringify(factCheckReport, null, 2)}

Remove or revise anything flagged. When in doubt, OMIT. Return the final clean JSON.`;
  const result = await callAgent(FIREWALL_SYSTEM, prompt);
  return parseJson(result);
}

// ─── PIPELINE ORCHESTRATOR ──────────────────────────────────────────────────

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
        linkedinUrl: "",
        priorCompanies: f.priorCompanies || "",
      }));
  }

  return result;
}

type ProgressCallback = (event: any) => void;

async function runPipeline(input: string, onProgress?: ProgressCallback): Promise<EnrichedCompany> {
  const emit = (data: any) => {
    if (onProgress) onProgress(data);
  };

  emit({ type: "stage", agent: "identifier", step: 1, total: 4, message: "Identifying company from input..." });
  console.log("[Enrichment] Agent 1/4: Identifier — resolving company from input...");
  const identity = await runIdentifierAgent(input);
  console.log(`[Enrichment] Identified: "${identity.companyName}" (confidence: ${identity.confidence})`);
  emit({ type: "stage_complete", agent: "identifier", step: 1, companyName: identity.companyName, confidence: identity.confidence });

  if (identity.confidence === "low" && !identity.companyName) {
    throw new Error("Could not confidently identify a company from the provided input. Please try a more specific URL or company name.");
  }

  emit({ type: "stage", agent: "researcher", step: 2, total: 4, message: `Researching ${identity.companyName}...` });
  console.log("[Enrichment] Agent 2/4: Research — building deal card...");
  const researchDraft = await runResearchAgent(identity.companyName, identity.domain, input);
  console.log("[Enrichment] Research draft complete.");
  emit({ type: "stage_complete", agent: "researcher", step: 2 });

  emit({ type: "stage", agent: "fact_checker", step: 3, total: 4, message: "Fact-checking all claims..." });
  console.log("[Enrichment] Agent 3/4: Fact-Checker — verifying claims...");
  const factCheckReport = await runFactCheckerAgent(identity.companyName, researchDraft);
  const issueCount = factCheckReport.flaggedIssues?.length || 0;
  console.log(`[Enrichment] Fact-check: ${factCheckReport.overallAssessment} (${issueCount} issues flagged)`);
  emit({ type: "stage_complete", agent: "fact_checker", step: 3, issuesFound: issueCount, assessment: factCheckReport.overallAssessment });

  emit({ type: "stage", agent: "firewall", step: 4, total: 4, message: "Applying hallucination firewall..." });
  console.log("[Enrichment] Agent 4/4: Hallucination Firewall — producing clean output...");
  const cleanOutput = await runFirewallAgent(researchDraft, factCheckReport);
  console.log("[Enrichment] Pipeline complete. Validated output ready.");
  emit({ type: "stage_complete", agent: "firewall", step: 4 });

  return validateOutput(cleanOutput);
}

export async function enrichFromInput(input: string): Promise<EnrichedCompany> {
  console.log("[Enrichment] Starting 4-agent pipeline...");
  return runPipeline(input);
}

export async function enrichFromInputWithProgress(input: string, onProgress: ProgressCallback): Promise<EnrichedCompany> {
  console.log("[Enrichment] Starting 4-agent pipeline (with progress)...");
  return runPipeline(input, onProgress);
}
