import { storage } from "./storage";
import { db } from "./db";
import { companies } from "@shared/schema";

export async function seedDatabase() {
  const existing = await db.select().from(companies).limit(1);
  if (existing.length > 0) return;

  const seedCompanies = [
    {
      name: "Synthwave AI",
      oneLiner: "AI-powered code review and security analysis for engineering teams",
      description: "Synthwave AI builds developer tools that use large language models to automatically review pull requests, detect security vulnerabilities, and suggest architectural improvements. Their platform integrates with GitHub, GitLab, and Bitbucket, providing real-time feedback during the development workflow.",
      sector: "AI Infra",
      businessModel: "SaaS",
      stage: "Seed",
      fundingHistory: "Pre-seed: $1.2M from Y Combinator (W24 batch). Currently raising Seed round targeting $5M.",
      competitiveLandscape: "CodeRabbit, Snyk Code, GitHub Copilot, Sourcegraph Cody, Qodo (formerly CodiumAI)",
      sourceUrl: "https://synthwave.ai",
      pipelineStage: "researching",
      tags: ["AI Agents", "DevTools", "Security"],
    },
    {
      name: "Meridian Finance",
      oneLiner: "Embedded treasury management for mid-market SaaS companies",
      description: "Meridian provides an API-first treasury management platform that lets SaaS companies optimize their cash positions, automate FX hedging, and manage multi-currency operations. Their product sits between banking infrastructure and ERP systems, offering real-time cash visibility and automated sweep accounts.",
      sector: "Fintech",
      businessModel: "API / Platform",
      stage: "Series A",
      fundingHistory: "Seed: $3.5M led by Ribbit Capital (2023). Series A: $18M led by a16z (2024).",
      competitiveLandscape: "Trovata, Kyriba, HighRadius, Ramp Treasury, Modern Treasury",
      sourceUrl: "https://meridianfinance.com",
      pipelineStage: "in_diligence",
      tags: ["Fintech", "B2B", "API"],
    },
    {
      name: "Canopy Climate",
      oneLiner: "Satellite-based carbon credit verification using computer vision",
      description: "Canopy Climate uses satellite imagery and ML models to independently verify carbon offset projects in real-time. Their technology can detect deforestation, measure biomass changes, and validate carbon sequestration claims with 95%+ accuracy, bringing transparency to voluntary carbon markets.",
      sector: "Climate",
      businessModel: "SaaS",
      stage: "Pre-seed",
      fundingHistory: "Bootstrapped. Accepted into Techstars Climate cohort (2024).",
      competitiveLandscape: "Pachama, NCX, Sylvera, Planet Labs (partial overlap), Dendra Systems",
      sourceUrl: "https://canopyclimate.io",
      pipelineStage: "discovered",
      tags: ["Climate", "Computer Vision", "Sustainability"],
    },
    {
      name: "Nexus Protocol",
      oneLiner: "Cross-chain messaging layer for institutional DeFi applications",
      description: "Nexus Protocol builds the infrastructure layer that enables institutional-grade DeFi applications to operate across multiple blockchains. Their messaging protocol ensures atomic execution, MEV protection, and regulatory compliance features that traditional bridges lack.",
      sector: "Crypto / Web3",
      businessModel: "Infrastructure",
      stage: "Seed",
      fundingHistory: "Seed: $8M led by Paradigm with participation from Electric Capital (2024).",
      competitiveLandscape: "LayerZero, Axelar, Wormhole, Chainlink CCIP, Hyperlane",
      sourceUrl: "https://nexusprotocol.xyz",
      pipelineStage: "reaching_out",
      tags: ["Crypto Infra", "DeFi", "Infrastructure"],
    },
    {
      name: "Luminary Health",
      oneLiner: "AI diagnostics platform for early cancer detection in primary care",
      description: "Luminary Health develops FDA-cleared AI models that analyze routine blood work and imaging to flag early-stage cancers during primary care visits. Their platform has shown 3x improvement in early detection rates across pilot programs with major health systems.",
      sector: "Healthcare",
      businessModel: "SaaS",
      stage: "Series A",
      fundingHistory: "Seed: $6M led by Khosla Ventures (2023). Series A: $25M led by General Catalyst (2024). FDA 510(k) clearance obtained Q3 2024.",
      competitiveLandscape: "GRAIL (Illumina), Tempus, PathAI, Paige AI, Freenome",
      sourceUrl: "https://luminaryhealth.com",
      pipelineStage: "in_diligence",
      tags: ["Healthcare", "AI", "Diagnostics"],
    },
    {
      name: "Orbiter",
      oneLiner: "No-code internal tool builder with native AI capabilities",
      description: "Orbiter lets operations and product teams build sophisticated internal tools without writing code. Unlike Retool or Appsmith, Orbiter features built-in AI components for data extraction, natural language queries, and automated workflows that adapt to changing data schemas.",
      sector: "DevTools",
      businessModel: "SaaS",
      stage: "Seed",
      fundingHistory: "Pre-seed: $2M from Craft Ventures (2024). Currently raising Seed.",
      competitiveLandscape: "Retool, Appsmith, Airplane.dev, Superblocks, Glide",
      sourceUrl: "https://orbiter.dev",
      pipelineStage: "discovered",
      tags: ["No-Code", "AI", "Internal Tools"],
    },
  ];

  for (const companyData of seedCompanies) {
    const company = await storage.createCompany(companyData);

    if (company.name === "Synthwave AI") {
      await storage.createFounder({
        companyId: company.id,
        name: "Sarah Chen",
        role: "CEO & Co-founder",
        bio: "Former Staff Engineer at Google DeepMind. PhD in ML from Stanford. Built internal code review tools used by 10k+ engineers.",
        linkedinUrl: "https://linkedin.com/in/sarahchen",
        twitterUrl: "https://twitter.com/sarahchen_ai",
        priorCompanies: "Google DeepMind, Stripe",
      });
      await storage.createFounder({
        companyId: company.id,
        name: "Marcus Williams",
        role: "CTO & Co-founder",
        bio: "Ex-Principal Engineer at GitHub. Created several popular open-source static analysis tools with 50k+ stars combined.",
        linkedinUrl: "https://linkedin.com/in/marcuswilliams",
        twitterUrl: "https://twitter.com/mwilliams_dev",
        priorCompanies: "GitHub, Microsoft, Palantir",
      });
      await storage.createNote({
        companyId: company.id,
        content: "Strong demo - their code review agent caught several real vulnerabilities in our test repo that other tools missed. Team has deep domain expertise. Need to dig deeper into their go-to-market strategy for enterprise.",
      });
    }

    if (company.name === "Meridian Finance") {
      await storage.createFounder({
        companyId: company.id,
        name: "James Park",
        role: "CEO & Co-founder",
        bio: "Former VP of Treasury at Stripe. 15 years in fintech and banking infrastructure.",
        linkedinUrl: "https://linkedin.com/in/jamespark",
        twitterUrl: "https://twitter.com/jpark_fintech",
        priorCompanies: "Stripe, JPMorgan, Goldman Sachs",
      });
      await storage.createNote({
        companyId: company.id,
        content: "Had initial call with James - very impressive background and clear vision. They have 15 paying customers already doing $800K ARR. a16z is leading their Series A but there might be room for a small allocation. Following up next week.",
      });
      await storage.createNote({
        companyId: company.id,
        content: "Reference call with their customer (CFO at Gusto) was very positive. They described Meridian as 'the only tool that actually understands multi-entity treasury operations.'",
      });
    }

    if (company.name === "Canopy Climate") {
      await storage.createFounder({
        companyId: company.id,
        name: "Dr. Elena Rodriguez",
        role: "CEO & Founder",
        bio: "Former NASA climate scientist. Published 30+ papers on remote sensing and forest biomass estimation.",
        linkedinUrl: "https://linkedin.com/in/elenarodriguez",
        twitterUrl: "https://twitter.com/elena_climate",
        priorCompanies: "NASA JPL, Planet Labs",
      });
    }

    if (company.name === "Nexus Protocol") {
      await storage.createFounder({
        companyId: company.id,
        name: "Alex Novak",
        role: "CEO & Co-founder",
        bio: "Former core contributor to Ethereum. Built cross-chain bridges at Cosmos. Deep expertise in consensus mechanisms and cryptographic protocols.",
        linkedinUrl: "https://linkedin.com/in/alexnovak",
        twitterUrl: "https://twitter.com/alexnovak_web3",
        priorCompanies: "Cosmos, Ethereum Foundation",
      });
    }

    if (company.name === "Luminary Health") {
      await storage.createFounder({
        companyId: company.id,
        name: "Dr. Priya Sharma",
        role: "CEO & Co-founder",
        bio: "Board-certified oncologist. Previously led AI research at Memorial Sloan Kettering. Published in Nature Medicine on liquid biopsy biomarkers.",
        linkedinUrl: "https://linkedin.com/in/priyasharma",
        twitterUrl: "https://twitter.com/drpriyasharma",
        priorCompanies: "Memorial Sloan Kettering, Mount Sinai",
      });
      await storage.createFounder({
        companyId: company.id,
        name: "David Kim",
        role: "CTO & Co-founder",
        bio: "ML infrastructure expert. Built the ML platform at Oscar Health serving 1M+ members.",
        linkedinUrl: "https://linkedin.com/in/davidkim",
        twitterUrl: "https://twitter.com/dkim_ml",
        priorCompanies: "Oscar Health, Google Health",
      });
      await storage.createNote({
        companyId: company.id,
        content: "FDA clearance is a major moat. Their clinical trial data shows statistically significant improvement in early detection. Spoke with two health system CTOs who are piloting the platform - both planning to expand. This is a strong candidate for our healthcare thesis.",
      });
    }
  }

  console.log("Database seeded with sample deal data");
}
