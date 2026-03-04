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

function buildPrompt(input: string): string {
  return `You are an expert VC analyst AI. Your job is to identify a startup/company from ANY piece of information and produce a comprehensive deal card.

The user will give you some input — it could be ANYTHING:
- A company website URL (e.g. https://stripe.com)
- A link to a tweet or X/Twitter post *about* a company
- A founder's Twitter/X profile URL
- A founder's LinkedIn profile URL
- A blog post or article about a company
- A Product Hunt page
- A Crunchbase or PitchBook link
- A GitHub repository URL
- A plain company name
- A short description or snippet of text mentioning a company
- Any other URL or text that references a company

YOUR TASK:
1. First, figure out WHICH COMPANY is being referenced. This is critical — the input may not be the company's own website. A tweet by a founder, a blog reviewing a product, or a LinkedIn profile all point to a company. Identify it.
2. Then, use your knowledge to fill out a comprehensive deal card about that company.

INPUT: ${input}

Return a JSON object with these fields. Fill in as much as you can from your knowledge. If you genuinely don't know something, use an empty string for text fields or empty array for arrays. Do NOT make up facts — only include information you're confident about.

{
  "name": "Official company name",
  "oneLiner": "What the company does in one concise sentence",
  "description": "2-3 paragraph description covering: what they build, the problem they solve, their target market, traction/noteworthy achievements, and why a VC should care",
  "sector": "One of: ${SECTORS.join(", ")}",
  "businessModel": "One of: ${BUSINESS_MODELS.join(", ")}",
  "stage": "One of: ${STAGES.join(", ")}",
  "fundingHistory": "Known funding rounds with dates, amounts, and lead investors. If unknown, empty string.",
  "competitiveLandscape": "3-5 comparable or competing companies. For each, briefly note how the subject company differentiates.",
  "tags": ["relevant", "tags", "2-5 tags"],
  "founders": [
    {
      "name": "Founder full name",
      "role": "Title (e.g. CEO, CTO, Co-founder)",
      "bio": "Brief background — education, prior roles, notable achievements",
      "linkedinUrl": "LinkedIn URL if you know it, otherwise empty string",
      "priorCompanies": "Previous companies they founded or worked at, comma separated"
    }
  ]
}

IMPORTANT RULES:
- Return ONLY valid JSON. No markdown code fences, no explanation, no preamble.
- For sector, businessModel, and stage: use EXACTLY one of the values listed above, or empty string if unsure.
- For tags: suggest 2-5 relevant tags (e.g. "AI Agents", "Developer Tools", "B2B", "Open Source", "Vertical SaaS").
- For founders: include all known co-founders. It's fine to have an empty array if you don't know them.
- If the input is a founder's profile, identify their current company and enrich that.
- If the input is a tweet or blog post, identify which company is being discussed and enrich that.`;
}

function parseAndValidate(text: string): EnrichedCompany {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const parsed = JSON.parse(cleaned) as EnrichedCompany;

  if (!SECTORS.includes(parsed.sector)) parsed.sector = "";
  if (!BUSINESS_MODELS.includes(parsed.businessModel)) parsed.businessModel = "";
  if (!STAGES.includes(parsed.stage)) parsed.stage = "";

  if (!parsed.name) parsed.name = "";
  if (!parsed.oneLiner) parsed.oneLiner = "";
  if (!parsed.tags) parsed.tags = [];
  if (!parsed.founders) parsed.founders = [];

  return parsed;
}

export async function enrichFromInput(input: string): Promise<EnrichedCompany> {
  const message = await anthropic.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: buildPrompt(input),
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response from AI");
  }

  return parseAndValidate(content.text);
}

export async function enrichCompanyFromUrl(url: string): Promise<EnrichedCompany> {
  return enrichFromInput(url);
}

export async function enrichCompanyFromName(name: string): Promise<EnrichedCompany> {
  return enrichFromInput(name);
}
