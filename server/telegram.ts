import { Bot } from "grammy";
import { storage } from "./storage";
import type { InsertCompany } from "@shared/schema";
import crypto from "crypto";

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
      "To link your account:\n" +
      "1. Go to BookMark app → Settings\n" +
      "2. Click 'Generate Telegram Link Code'\n" +
      "3. Send: /link YOUR_CODE\n\n" +
      "Once linked, just drop any link or company name and I'll save it to your pipeline. Use the web app for AI enrichment."
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
      await ctx.reply(
        `Account linked successfully!\n\n` +
        "Now just drop any link or company name here and I'll save it to your pipeline. Use the web app for AI enrichment.\n\n" +
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
      await ctx.reply("No credits remaining for Telegram enrichments. Fund your wallet and use the BookMark app for pay-per-use enrichment, or purchase credits to use via Telegram.");
      return;
    }

    const processingMsg = await ctx.reply("Processing deal...");

    try {
      const deducted = await storage.deductCredit(user.id);
      if (!deducted) {
        await ctx.api.editMessageText(chatId, processingMsg.message_id, "No credits remaining.");
        return;
      }

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

      const founderLine = "";
      const sectorLine = "";
      const stageLine = "";

      await ctx.api.editMessageText(
        chatId,
        processingMsg.message_id,
        `Deal saved to pipeline!\n\n` +
        `${company.name}\n` +
        `Open BookMark in your browser to run AI enrichment on this deal.\n\n` +
        `Added to: Discovered`
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
