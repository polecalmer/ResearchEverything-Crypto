import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

interface EnrichedCompany {
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

export async function enrichCompanyFromUrl(url: string): Promise<EnrichedCompany> {
  const message = await anthropic.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: `You are a VC analyst AI. Given this URL, research and extract comprehensive information about the company.

URL: ${url}

Based on the URL and your knowledge of this company, return a JSON object with the following fields. Fill in as much as you can. If you don't know something, use an empty string for text fields or empty array for arrays.

{
  "name": "Company name",
  "oneLiner": "What the company does in one concise sentence",
  "description": "2-3 paragraph description of the company, its product, market position, and why it matters",
  "sector": "One of: ${SECTORS.join(", ")}",
  "businessModel": "One of: ${BUSINESS_MODELS.join(", ")}",
  "stage": "One of: ${STAGES.join(", ")}",
  "fundingHistory": "Known funding rounds, investors, and amounts",
  "competitiveLandscape": "3-5 comparable or competing companies and how this company differentiates",
  "tags": ["relevant", "tags", "for", "categorization"],
  "founders": [
    {
      "name": "Founder name",
      "role": "Title (e.g. CEO, CTO)",
      "bio": "Brief background",
      "linkedinUrl": "LinkedIn URL if known, otherwise empty string",
      "priorCompanies": "Previous companies, comma separated"
    }
  ]
}

IMPORTANT: 
- Return ONLY valid JSON, no markdown code fences, no explanation.
- For sector, businessModel, and stage, use EXACTLY one of the values listed above.
- For tags, suggest 2-5 relevant tags like "AI Agents", "Developer Tools", "B2B", etc.
- For founders, include all known co-founders.`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response from AI");
  }

  let text = content.text.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const parsed = JSON.parse(text) as EnrichedCompany;

  if (!SECTORS.includes(parsed.sector)) parsed.sector = "";
  if (!BUSINESS_MODELS.includes(parsed.businessModel)) parsed.businessModel = "";
  if (!STAGES.includes(parsed.stage)) parsed.stage = "";

  return parsed;
}

export async function enrichCompanyFromName(name: string): Promise<EnrichedCompany> {
  const message = await anthropic.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: `You are a VC analyst AI. Research and extract comprehensive information about this company.

Company name: ${name}

Based on your knowledge of this company, return a JSON object with the following fields. Fill in as much as you can. If you don't know something, use an empty string for text fields or empty array for arrays.

{
  "name": "${name}",
  "oneLiner": "What the company does in one concise sentence",
  "description": "2-3 paragraph description of the company, its product, market position, and why it matters",
  "sector": "One of: ${SECTORS.join(", ")}",
  "businessModel": "One of: ${BUSINESS_MODELS.join(", ")}",
  "stage": "One of: ${STAGES.join(", ")}",
  "fundingHistory": "Known funding rounds, investors, and amounts",
  "competitiveLandscape": "3-5 comparable or competing companies and how this company differentiates",
  "tags": ["relevant", "tags", "for", "categorization"],
  "founders": [
    {
      "name": "Founder name",
      "role": "Title (e.g. CEO, CTO)",
      "bio": "Brief background",
      "linkedinUrl": "LinkedIn URL if known, otherwise empty string",
      "priorCompanies": "Previous companies, comma separated"
    }
  ]
}

IMPORTANT: 
- Return ONLY valid JSON, no markdown code fences, no explanation.
- For sector, businessModel, and stage, use EXACTLY one of the values listed above.
- For tags, suggest 2-5 relevant tags like "AI Agents", "Developer Tools", "B2B", etc.
- For founders, include all known co-founders.`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response from AI");
  }

  let text = content.text.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const parsed = JSON.parse(text) as EnrichedCompany;

  if (!SECTORS.includes(parsed.sector)) parsed.sector = "";
  if (!BUSINESS_MODELS.includes(parsed.businessModel)) parsed.businessModel = "";
  if (!STAGES.includes(parsed.stage)) parsed.stage = "";

  return parsed;
}
