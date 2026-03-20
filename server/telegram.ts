import { Bot } from "grammy";
import { storage } from "./storage";
import { enrichFromInput } from "./enrichment";
import type { InsertCompany } from "@shared/schema";

let bot: Bot | null = null;

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
    await ctx.reply(
      "Welcome to BookMark Deal Bot!\n\n" +
      "Link your BookMark account to start dropping deals directly from Telegram.\n\n" +
      "Send: /link your_username your_password\n\n" +
      "Once linked, just drop any link or company name and I'll enrich it and add it to your pipeline automatically."
    );
  });

  bot.command("link", async (ctx) => {
    const text = ctx.message?.text || "";
    const parts = text.split(/\s+/).slice(1);

    if (parts.length < 2) {
      await ctx.reply("Usage: /link your_username your_password");
      return;
    }

    const [username, password] = parts;
    const chatId = ctx.chat.id.toString();

    try {
      const { comparePasswords } = await import("./auth");
      const user = await storage.getUserByUsername(username);

      if (!user) {
        await ctx.reply("Account not found. Check your username and try again.");
        return;
      }

      const valid = await comparePasswords(password, user.password);
      if (!valid) {
        await ctx.reply("Invalid password. Try again.");
        return;
      }

      await storage.linkTelegramChat(user.id, chatId);
      await ctx.reply(
        `Linked to ${username}! You're all set.\n\n` +
        "Now just drop any link or company name here and I'll enrich it and add it to your deal pipeline.\n\n" +
        "Commands:\n" +
        "/status — Check your credits and deal count\n" +
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

    const credits = await storage.getUserCredits(user.id);
    const companies = await storage.getCompanies(user.id);

    await ctx.reply(
      `Account: ${user.username}\n` +
      `Credits: ${credits >= 999999 ? "Unlimited" : credits}\n` +
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
        "Send /link your_username your_password to connect your BookMark account."
      );
      return;
    }

    const credits = await storage.getUserCredits(user.id);
    if (credits <= 0) {
      await ctx.reply("No credits remaining. Purchase more credits in the BookMark app to continue enriching deals.");
      return;
    }

    const processingMsg = await ctx.reply("Processing deal...");

    try {
      const deducted = await storage.deductCredit(user.id);
      if (!deducted) {
        await ctx.api.editMessageText(chatId, processingMsg.message_id, "No credits remaining.");
        return;
      }

      const enriched = await enrichFromInput(text);

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
        `Deal added to pipeline!\n\n` +
        `${enriched.name}\n` +
        `${enriched.oneLiner}` +
        sectorLine +
        stageLine +
        founderLine +
        `\n\nAdded to: Discovered`
      );
    } catch (error: any) {
      console.error("[Telegram] Enrichment error:", error);
      await ctx.api.editMessageText(
        chatId,
        processingMsg.message_id,
        `Failed to process: ${error.message}\n\nYour credit was not consumed if enrichment failed before the AI pipeline started.`
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
