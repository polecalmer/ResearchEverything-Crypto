import { Bot } from "grammy";
import { storage } from "./storage";
import type { InsertCompany } from "@shared/schema";
import crypto from "crypto";
import { callAnthropicServer, isServerMppReady } from "./mpp-client";
import {
  startEnrichmentSession, advanceEnrichmentSession,
  type EnrichedCompany,
} from "./enrichment";

let bot: Bot | null = null;

const linkCodes = new Map<string, { userId: string; expiresAt: number }>();

export function generateTelegramLinkCode(userId: string): string {
  for (const [code, data] of linkCodes) {
    if (data.userId === userId) linkCodes.delete(code);
  }
  const code = crypto.randomBytes(4).toString("hex").toUpperCase();
  linkCodes.set(code, { userId, expiresAt: Date.now() + 10 * 60 * 1000 });
  return code;
}

async function runServerEnrichment(input: string, userId: string): Promise<EnrichedCompany> {
  const { sessionId, anthropicRequest } = await startEnrichmentSession(input, userId);

  let currentRequest = anthropicRequest;
  const MAX_STEPS = 10;

  for (let step = 0; step < MAX_STEPS; step++) {
    const anthropicResponse = await callAnthropicServer(currentRequest);

    const result = await advanceEnrichmentSession(
      sessionId,
      userId,
      anthropicResponse.text,
      anthropicResponse.usage,
    );

    if (result.result) {
      return result.result.enriched;
    }

    if (result.anthropicRequest) {
      currentRequest = result.anthropicRequest;
    } else {
      throw new Error("Unexpected response from enrichment step");
    }
  }

  throw new Error("Enrichment pipeline exceeded maximum steps");
}

export function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log("[Telegram] No TELEGRAM_BOT_TOKEN set, skipping bot startup");
    return;
  }

  bot = new Bot(token);

  bot.catch((err) => {
    if (err.message?.includes("409") || err.message?.includes("terminated by other getUpdates")) {
      console.log("[Telegram] Another bot instance is running, stopping this one gracefully");
      bot?.stop();
    } else {
      console.error("[Telegram] Bot error:", err.message);
    }
  });

  bot.command("start", async (ctx) => {
    const enrichReady = isServerMppReady();
    await ctx.reply(
      "Welcome to BookMark Deal Bot!\n\n" +
      "To link your account:\n" +
      "1. Go to BookMark app → Settings\n" +
      "2. Click 'Generate Telegram Link Code'\n" +
      "3. Send: /link YOUR_CODE\n\n" +
      (enrichReady
        ? "Once linked, drop any link or company name and I'll enrich it with AI and add it to your pipeline."
        : "Once linked, drop any link or company name and I'll save it to your pipeline.")
    );
  });

  bot.command("link", async (ctx) => {
    const text = ctx.message?.text || "";
    const parts = text.split(/\s+/).slice(1);

    if (parts.length < 1) {
      await ctx.reply("Usage: /link YOUR_CODE\n\nGenerate a link code from your BookMark app first.");
      return;
    }

    const code = parts[0].toUpperCase().trim();
    const chatId = ctx.chat.id.toString();

    const codeData = linkCodes.get(code);
    if (!codeData) {
      await ctx.reply("Invalid or expired code. Generate a new one from your BookMark app.");
      return;
    }

    if (codeData.expiresAt < Date.now()) {
      linkCodes.delete(code);
      await ctx.reply("Code expired. Generate a new one from your BookMark app.");
      return;
    }

    try {
      linkCodes.delete(code);
      const user = await storage.getUser(codeData.userId);

      if (!user) {
        await ctx.reply("Account not found. Try generating a new code.");
        return;
      }

      await storage.linkTelegramChat(user.id, chatId);
      const enrichReady = isServerMppReady();
      await ctx.reply(
        `Account linked successfully!\n\n` +
        (enrichReady
          ? "Now just drop any link or company name here and I'll enrich it with AI and add it to your deal pipeline.\n\n"
          : "Now just drop any link or company name here and I'll save it to your pipeline.\n\n") +
        "Commands:\n" +
        "/status — Check your deal count\n" +
        "/unlink — Disconnect your account"
      );
    } catch (error: any) {
      console.error("[Telegram] Link error:", error);
      await ctx.reply("Something went wrong. Try again later.");
    }
  });

  bot.command("unlink", async (ctx) => {
    const chatId = ctx.chat.id.toString();
    const user = await storage.getUserByTelegramChatId(chatId);

    if (!user) {
      await ctx.reply("No account linked. Use /link to connect your BookMark account.");
      return;
    }

    await storage.linkTelegramChat(user.id, "");
    await ctx.reply("Account unlinked. Use /link to reconnect.");
  });

  bot.command("status", async (ctx) => {
    const chatId = ctx.chat.id.toString();
    const user = await storage.getUserByTelegramChatId(chatId);

    if (!user) {
      await ctx.reply("No account linked. Use /link to connect your BookMark account.");
      return;
    }

    const companies = await storage.getCompanies(user.id);
    const walletLine = user.walletAddress
      ? `Wallet: ${user.walletAddress.slice(0, 6)}...${user.walletAddress.slice(-4)}`
      : "Wallet: Not connected";

    await ctx.reply(
      `Account: ${user.email || user.username}\n` +
      `${walletLine}\n` +
      `Deals in pipeline: ${companies.length}`
    );
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;

    if (text.startsWith("/")) return;

    const chatId = ctx.chat.id.toString();
    const user = await storage.getUserByTelegramChatId(chatId);

    if (!user) {
      await ctx.reply(
        "No account linked yet.\n\n" +
        "Generate a link code from your BookMark app, then send: /link YOUR_CODE"
      );
      return;
    }

    const credits = await storage.getUserCredits(user.id);
    if (credits <= 0) {
      await ctx.reply("No credits remaining. Purchase more credits in the BookMark app to continue using Telegram enrichment.");
      return;
    }

    const processingMsg = await ctx.reply("Processing deal...");

    try {
      const deducted = await storage.deductCredit(user.id);
      if (!deducted) {
        await ctx.api.editMessageText(chatId, processingMsg.message_id, "No credits remaining.");
        return;
      }

      const enrichAvailable = isServerMppReady();

      if (enrichAvailable) {
        await ctx.api.editMessageText(chatId, processingMsg.message_id, "Enriching deal with AI... this may take 30-60 seconds.");

        const enriched = await runServerEnrichment(text, user.id);

        const isUrl = text.startsWith("http://") || text.startsWith("https://");
        let websiteUrl = enriched.websiteUrl || "";
        if (isUrl && !websiteUrl) {
          const socialDomains = ["twitter.com", "x.com", "linkedin.com", "github.com", "producthunt.com"];
          const isSocial = socialDomains.some((d) => text.includes(d));
          if (!isSocial) websiteUrl = text;
        }

        const companyData: InsertCompany = {
          name: enriched.name,
          oneLiner: enriched.oneLiner,
          description: enriched.description || null,
          sector: enriched.sector || null,
          subSector: enriched.subSector || null,
          businessModel: enriched.businessModel || null,
          stage: enriched.stage || null,
          fundingHistory: enriched.fundingHistory || null,
          competitiveLandscape: enriched.competitiveLandscape || null,
          pipelineStage: "discovered",
          tags: enriched.tags || [],
          websiteUrl: websiteUrl || null,
          githubUrl: enriched.githubUrl || null,
          twitterUrl: enriched.twitterUrl || null,
          linkedinUrl: enriched.linkedinUrl || null,
          sourceUrl: isUrl ? text : null,
          imageUrl: null,
        };

        const company = await storage.createCompany({
          ...companyData,
          userId: user.id,
        } as any);

        if (enriched.founders && enriched.founders.length > 0) {
          for (const founder of enriched.founders.slice(0, 5)) {
            await storage.createFounder({
              companyId: company.id,
              name: founder.name,
              role: founder.role || null,
              bio: founder.bio || null,
              linkedinUrl: founder.linkedinUrl || null,
              twitterUrl: founder.twitterUrl || null,
              githubUrl: null,
              personalUrl: null,
              priorCompanies: founder.priorCompanies || null,
            });
          }
        }

        const founderLine = enriched.founders && enriched.founders.length > 0
          ? `\nFounders: ${enriched.founders.map((f: any) => f.name).join(", ")}`
          : "";
        const sectorLine = enriched.sector ? `\nSector: ${enriched.sector}` : "";
        const stageLine = enriched.stage ? `\nStage: ${enriched.stage}` : "";

        await ctx.api.editMessageText(
          chatId,
          processingMsg.message_id,
          `Deal enriched and added!\n\n` +
          `${enriched.name}\n` +
          `${enriched.oneLiner}` +
          sectorLine +
          stageLine +
          founderLine +
          `\n\nAdded to: Discovered`
        );
      } else {
        const isUrl = text.startsWith("http://") || text.startsWith("https://");

        const companyData: InsertCompany = {
          name: isUrl ? text : text.slice(0, 100),
          oneLiner: "Saved via Telegram — enrich in the web app",
          description: null,
          sector: null,
          subSector: null,
          businessModel: null,
          stage: null,
          fundingHistory: null,
          competitiveLandscape: null,
          pipelineStage: "discovered",
          tags: [],
          websiteUrl: isUrl ? text : null,
          githubUrl: null,
          twitterUrl: null,
          linkedinUrl: null,
          sourceUrl: isUrl ? text : null,
          imageUrl: null,
        };

        const company = await storage.createCompany({
          ...companyData,
          userId: user.id,
        } as any);

        await ctx.api.editMessageText(
          chatId,
          processingMsg.message_id,
          `Deal saved to pipeline!\n\n` +
          `${company.name}\n` +
          `Open BookMark in your browser to run AI enrichment on this deal.\n\n` +
          `Added to: Discovered`
        );
      }
    } catch (error: any) {
      console.error("[Telegram] Enrichment error:", error);
      await ctx.api.editMessageText(
        chatId,
        processingMsg.message_id,
        `Failed to process: ${error.message}`
      );
    }
  });

  bot.start({
    onStart: () => console.log("[Telegram] Bot started successfully"),
  }).catch((err: any) => {
    if (err?.message?.includes("409") || err?.message?.includes("terminated by other getUpdates")) {
      console.log("[Telegram] Another bot instance is running (e.g. deployed version), skipping polling in dev");
    } else {
      console.error("[Telegram] Bot polling error:", err?.message || err);
    }
  });
}

export function stopTelegramBot() {
  if (bot) {
    bot.stop();
    bot = null;
  }
}
