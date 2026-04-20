import type { Express } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { requireAuth } from "../auth";
import { db } from "../db";
import { sql } from "drizzle-orm";

export function registerResearchRoutes(app: Express) {
  app.get("/api/research/sessions", requireAuth, async (req, res) => {
    try {
      const sessions = await storage.getConversations(req.user!.id, "research");
      res.json(sessions);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/research/saved-models", requireAuth, async (req, res) => {
    try {
      const models = await storage.getSavedModelsByUser(req.user!.id);
      res.json(models);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  let aggregateBrainCache: { data: any; expires: number } | null = null;
  app.get("/api/brain/aggregate", async (_req, res) => {
    try {
      if (aggregateBrainCache && aggregateBrainCache.expires > Date.now()) {
        return res.json(aggregateBrainCache.data);
      }
      const brains = await storage.getAllResearchBrains();

      const entityAgg: Record<string, { type: string; count: number; users: number }> = {};
      const edgeAgg: Record<string, { from: string; to: string; type: string; weight: number }> = {};

      for (const brain of brains) {
        const entities = (brain.entities || {}) as Record<string, any>;
        for (const [name, data] of Object.entries(entities)) {
          if (!name || typeof name !== "string") continue;
          const e = data as any;
          const type = e?.type || "concept";
          const count = Number(e?.researchCount) || 1;
          if (!entityAgg[name]) entityAgg[name] = { type, count: 0, users: 0 };
          entityAgg[name].count += count;
          entityAgg[name].users += 1;
        }
        const rels = (brain.relationships || []) as any[];
        for (const r of rels) {
          if (!r?.from || !r?.to) continue;
          const a = String(r.from);
          const b = String(r.to);
          const key = a < b ? `${a}|${b}|${r.type || "rel"}` : `${b}|${a}|${r.type || "rel"}`;
          if (!edgeAgg[key]) edgeAgg[key] = { from: a, to: b, type: r.type || "related_to", weight: 0 };
          edgeAgg[key].weight += 1;
        }
      }

      const topEntities = Object.entries(entityAgg)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 180);
      const allowed = new Set(topEntities.map(([n]) => n));
      const nodes = topEntities.map(([name, info]) => ({
        id: name,
        type: info.type,
        count: info.count,
        users: info.users,
      }));
      const edges = Object.values(edgeAgg)
        .filter(e => allowed.has(e.from) && allowed.has(e.to))
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 400);

      const totalEntities = Object.keys(entityAgg).length;
      const totalRelationships = Object.keys(edgeAgg).length;
      const data = {
        nodes,
        edges,
        stats: {
          totalEntities,
          totalRelationships,
          totalResearchers: brains.length,
          shownEntities: nodes.length,
          shownRelationships: edges.length,
        },
      };
      aggregateBrainCache = { data, expires: Date.now() + 5 * 60 * 1000 };
      res.json(data);
    } catch (e: any) {
      console.error("[BrainAggregate] Error:", e);
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/brain/graph", requireAuth, async (req, res) => {
    try {
      const brainRecord = await storage.getResearchBrain(req.user!.id);
      if (!brainRecord) {
        return res.json({
          entities: {},
          relationships: [],
          knowledge: [],
          contradictions: [],
          preferences: {},
          meta: { totalSessions: 0, lastActive: null, topEntities: [] },
        });
      }
      res.json({
        entities: brainRecord.entities || {},
        relationships: brainRecord.relationships || [],
        knowledge: brainRecord.knowledge || [],
        contradictions: brainRecord.contradictions || [],
        preferences: brainRecord.preferences || {},
        meta: brainRecord.meta || { totalSessions: 0, lastActive: null, topEntities: [] },
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/brain/preferences", requireAuth, async (req, res) => {
    try {
      const { preferences } = req.body;
      if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) {
        return res.status(400).json({ message: "preferences must be an object" });
      }

      const validKeys = new Set(["data_sources", "research_style", "analysis_lens", "custom_instructions"]);
      const cleaned: Record<string, string[]> = {};

      for (const [key, val] of Object.entries(preferences)) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
        if (!validKeys.has(key)) continue;
        if (!Array.isArray(val)) continue;
        const items = (val as any[])
          .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
          .map(v => v.trim().slice(0, 1000))
          .slice(0, 50);
        if (items.length > 0) cleaned[key] = items;
      }

      await storage.upsertResearchBrain(req.user!.id, { preferences: cleaned });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/research/sessions", requireAuth, async (req, res) => {
    try {
      const session = await storage.createConversation({
        userId: req.user!.id,
        title: req.body.title || "New Session",
        type: "research",
      });
      res.json(session);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/research/sessions/:id/messages", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid session ID" });
      const session = await storage.getConversation(id);
      if (!session || session.userId !== req.user!.id) {
        return res.status(404).json({ message: "Session not found" });
      }
      const msgs = await storage.getMessages(session.id);
      res.json(msgs);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/research/sessions/:id/messages", requireAuth, async (req, res) => {
    let keepalive: ReturnType<typeof setInterval> | null = null;
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid session ID" });
      const session = await storage.getConversation(id);
      if (!session || session.userId !== req.user!.id) {
        return res.status(404).json({ message: "Session not found" });
      }

      const { message, forceMode, refreshBrain, sessionMode } = req.body;
      const isDataMode = sessionMode === "data";
      if (!message || typeof message !== "string") {
        return res.status(400).json({ message: "Message is required" });
      }
      const validModes = ["quick", "focused", "deep"];
      const mode: "quick" | "focused" | "deep" | undefined = validModes.includes(forceMode) ? forceMode : undefined;

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();

      keepalive = setInterval(() => {
        res.write(": keepalive\n\n");
      }, 15000);

      const sendEvent = (event: string, data: any) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const userMsg = await storage.createMessage({
        conversationId: session.id,
        role: "user",
        content: message,
      });

      const history = await storage.getMessages(session.id);
      const historyForAgent = history.map(m => ({ role: m.role, content: m.content }));

      const brainRecord = await storage.getResearchBrain(req.user!.id);
      const brain = brainRecord ? {
        entities: (brainRecord.entities || {}) as Record<string, any>,
        knowledge: (brainRecord.knowledge || []) as any[],
        preferences: (brainRecord.preferences || {}) as Record<string, any>,
        relationships: (brainRecord.relationships || []) as any[],
        contradictions: (brainRecord.contradictions || []) as any[],
        meta: (brainRecord.meta || { totalSessions: 0, lastActive: new Date().toISOString().slice(0, 10), topEntities: [] }) as any,
      } : null;

      const { runSessionResearchAgent, parseArtifacts } = await import("../session-research-agent");

      let brainForAgent = brain;
      if (refreshBrain && brain) {
        const LIVE = /\b(price|tvl|mcap|market cap|fdv|fee|fees|revenue|volume|apy|apr|yield|supply|circulating|inflation|holders|active users|dau|wau)\b/i;
        const filtered = (brain.knowledge || []).filter((f: any) => {
          const text = `${f.topic || ""} ${f.fact || ""}`;
          return !LIVE.test(text);
        });
        brainForAgent = { ...brain, knowledge: filtered };
        console.log(`[SessionResearch] refreshBrain=true → dropped ${(brain.knowledge || []).length - filtered.length} live-metric facts from context`);
      }

      const result = await runSessionResearchAgent(
        message,
        historyForAgent.slice(0, -1),
        brainForAgent,
        (step) => sendEvent("step", step),
        isDataMode ? "focused" as const : mode,
        async (plan) => {
          try {
            await storage.updateMessagePlan(userMsg.id, plan);
            sendEvent("plan", plan);
          } catch (err: any) {
            console.error("[SessionResearch] Failed to persist plan:", err.message);
          }
        },
        req.user!.id,
        isDataMode,
      );
      sendEvent("mode", { mode: result.mode, reason: result.modeReason });

      const artifacts = parseArtifacts(result.content);
      const continuationTag = result.needsContinuation ? "<!-- needs_continuation -->\n" : "";
      const contentWithMode = `<!-- mode:${result.mode} -->\n${continuationTag}${result.content}`;
      const assistantMsg = await storage.createMessage({
        conversationId: session.id,
        role: "assistant",
        content: contentWithMode,
        artifacts: artifacts.length > 0 ? artifacts : undefined,
        kind: result.mode === "deep" ? "deep_model" : undefined,
      });

      if (history.length <= 2) {
        const titleSnippet = message.slice(0, 60) + (message.length > 60 ? "..." : "");
        await storage.updateConversationTitle(session.id, titleSnippet);
      }

      if (result.brainUpdates) {
        try {
          const existing = brainRecord || { entities: {}, knowledge: [], preferences: {}, relationships: [], contradictions: [], meta: { totalSessions: 0, lastActive: "", topEntities: [] } };
          const today = new Date().toISOString().slice(0, 10);
          const nowISO = new Date().toISOString();

          const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype", "toString", "valueOf"]);
          const mergedEntities = { ...(existing.entities as any || {}) };
          for (const [name, data] of Object.entries(result.brainUpdates.entities || {})) {
            if (FORBIDDEN_KEYS.has(name) || typeof name !== "string" || name.length > 100) continue;
            const prev = mergedEntities[name];
            if (prev) {
              mergedEntities[name] = {
                ...prev,
                ...data,
                researchCount: (prev.researchCount || 0) + 1,
                lastResearched: today,
                tags: [...new Set([...(prev.tags || []), ...(data.tags || [])])],
                competitors: [...new Set([...(prev.competitors || []), ...(data.competitors || [])])],
                chains: [...new Set([...(prev.chains || []), ...(data.chains || [])])],
              };
            } else {
              mergedEntities[name] = { ...data, researchCount: 1, lastResearched: today };
            }
          }

          const existingFacts = (existing.knowledge as any[] || []);
          const newContradictions = [...(existing.contradictions as any[] || [])];

          const newFacts = (result.brainUpdates.facts || []).reduce((acc: any[], f: any) => {
            const exactDupe = existingFacts.find((ef: any) =>
              ef.topic === f.topic && ef.fact === f.fact
            );
            if (exactDupe) return acc;

            const id = `fact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const existingFact = existingFacts.find((ef: any) =>
              ef.topic === f.topic && ef.entities?.some((e: string) => f.entities?.includes(e)) && ef.confidence !== "stale"
            );
            if (existingFact && existingFact.fact !== f.fact) {
              newContradictions.push({
                factIdOld: existingFact.id,
                factIdNew: id,
                summary: `${f.topic}: was "${existingFact.fact}" → now "${f.fact}"`,
                date: today,
              });
              existingFact.confidence = "stale";
              existingFact.supersedes = id;
            }
            acc.push({ ...f, id, date: nowISO });
            return acc;
          }, []);

          const LIVE_METRIC_RE = /\b(price|tvl|mcap|market cap|fdv|fee|fees|revenue|volume|apy|apr|yield|supply|circulating|inflation|holders|active users|dau|wau)\b/i;
          const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;
          const nowMs = Date.now();
          const combined = [...existingFacts, ...newFacts];
          const pruned = combined.filter((f: any) => {
            const text = `${f.topic || ""} ${f.fact || ""}`;
            if (!LIVE_METRIC_RE.test(text)) return true;
            if (!f.date) return true;
            const factTs = new Date(f.date).getTime();
            if (isNaN(factTs)) return true;
            return (nowMs - factTs) < SEVEN_DAYS_MS;
          });
          const droppedCount = combined.length - pruned.length;
          if (droppedCount > 0) {
            console.log(`[SessionResearch] Pruned ${droppedCount} stale live-metric facts (>7d old)`);
          }
          const mergedKnowledge = pruned.slice(-200);

          const existingRels = (existing.relationships as any[] || []);
          const newRels = (result.brainUpdates.relationships || []).filter((nr: any) =>
            !existingRels.some((er: any) => er.from === nr.from && er.to === nr.to && er.type === nr.type)
          ).map((r: any) => ({ ...r, date: today }));
          const mergedRelationships = [...existingRels, ...newRels].slice(-100);

          const entityCounts = Object.entries(mergedEntities)
            .map(([name, e]: [string, any]) => ({ name, count: e.researchCount || 0 }))
            .sort((a, b) => b.count - a.count);
          const topEntities = entityCounts.slice(0, 5).map(e => e.name);

          const mergedMeta = {
            totalSessions: ((existing.meta as any)?.totalSessions || 0) + 1,
            lastActive: today,
            topEntities,
          };

          await storage.upsertResearchBrain(req.user!.id, {
            entities: mergedEntities,
            knowledge: mergedKnowledge,
            preferences: { ...(existing.preferences as any || {}), ...(result.brainUpdates.preferences || {}) },
            relationships: mergedRelationships,
            contradictions: newContradictions.slice(-50),
            meta: mergedMeta,
          });
          console.log(`[SessionResearch] Brain merged: ${Object.keys(mergedEntities).length} entities, ${mergedKnowledge.length} facts, ${mergedRelationships.length} rels, ${newContradictions.length} contradictions`);

          try {
            const { syncBrainFacts, syncBrainEntities } = await import("../brain-embedding-sync");
            const factsToSync = newFacts.map((f: any) => ({
              id: f.id,
              topic: f.topic || "",
              fact: f.fact || "",
              entities: f.entities || [],
              source: f.source || "",
              date: f.date,
              confidence: f.confidence || "verified",
            }));
            const newEntityEntries: Record<string, any> = {};
            for (const [name, data] of Object.entries(result.brainUpdates.entities || {})) {
              newEntityEntries[name] = mergedEntities[name] || data;
            }
            const [fSynced, eSynced] = await Promise.all([
              syncBrainFacts(req.user!.id, factsToSync),
              syncBrainEntities(req.user!.id, newEntityEntries),
            ]);
            console.log(`[BrainSync] Embedded ${fSynced} facts, ${eSynced} entities`);
          } catch (syncErr: any) {
            console.warn("[BrainSync] Embedding sync failed (non-fatal):", syncErr.message);
          }
        } catch (brainErr: any) {
          console.warn("[SessionResearch] Brain update failed:", brainErr.message);
        }
      }

      await storage.logTransaction({
        userId: req.user!.id,
        type: "session_research",
        description: `Research: "${message.slice(0, 80)}"`,
        amount: result.mppCost.toFixed(4),
        apiCost: result.mppCost.toFixed(4),
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costBasis: result.costBasis,
      });

      clearInterval(keepalive);

      sendEvent("done", {
        message: assistantMsg,
        artifacts,
        mppCost: result.mppCost,
        toolCalls: result.toolCalls,
        needsContinuation: result.needsContinuation || false,
      });

      res.end();
    } catch (e: any) {
      if (keepalive) clearInterval(keepalive);
      console.error("[SessionResearch] Error:", e.message);
      if (!res.headersSent) {
        res.status(500).json({ message: e.message });
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ message: e.message })}\n\n`);
        res.end();
      }
    }
  });

  app.post("/api/research/sessions/:id/share", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid session ID" });
      const session = await storage.getConversation(id);
      if (!session || session.userId !== req.user!.id) {
        return res.status(404).json({ message: "Session not found" });
      }
      if (session.shareToken) {
        return res.json({ shareToken: session.shareToken });
      }
      const token = crypto.randomBytes(16).toString("hex");
      await storage.setConversationShareToken(id, token);
      res.json({ shareToken: token });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/research/sessions/:id/share", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid session ID" });
      const session = await storage.getConversation(id);
      if (!session || session.userId !== req.user!.id) {
        return res.status(404).json({ message: "Session not found" });
      }
      await storage.setConversationShareToken(id, null);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/shared/research/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const session = await storage.getConversationByShareToken(token);
      if (!session) return res.status(404).json({ message: "Shared session not found" });
      const msgs = await storage.getMessages(session.id);
      const user = session.userId ? await storage.getUser(session.userId) : null;
      res.json({
        title: session.title,
        createdAt: session.createdAt,
        author: user?.username || "Anonymous",
        messages: msgs.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          artifacts: m.artifacts,
          createdAt: m.createdAt,
        })),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/research/sessions/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid session ID" });
      const session = await storage.getConversation(id);
      if (!session || session.userId !== req.user!.id) {
        return res.status(404).json({ message: "Session not found" });
      }
      await storage.deleteConversation(session.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/research/messages/:msgId/save-to-report", requireAuth, async (req, res) => {
    try {
      const msgId = parseInt(req.params.msgId);
      if (isNaN(msgId)) return res.status(400).json({ message: "Invalid message ID" });
      const userId = req.user!.id;

      const msg = await storage.getMessage(msgId);
      if (!msg) return res.status(404).json({ message: "Message not found" });

      const conversation = await storage.getConversation(msg.conversationId);
      if (!conversation || conversation.userId !== userId) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const content = msg.content.replace(/^<!--\s*mode:\w+\s*-->\s*\n?/, "");
      const firstLine = content.split("\n").find(l => l.trim())?.replace(/^#+\s*/, "").slice(0, 100) || "Session Research";
      const title = `${conversation.title || "Session"} — ${firstLine}`;

      const report = await storage.createReport({
        companyId: "session-research",
        userId,
        title,
        content,
        status: "complete",
      });

      res.json({ id: report.id, title: report.title });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/research/messages/:msgId/save-as-model", requireAuth, async (req, res) => {
    try {
      const msgId = parseInt(req.params.msgId);
      if (isNaN(msgId)) return res.status(400).json({ message: "Invalid message ID" });
      const userId = req.user!.id;

      const msg = await storage.getMessage(msgId);
      if (!msg) return res.status(404).json({ message: "Message not found" });

      const conversation = await storage.getConversation(msg.conversationId);
      if (!conversation || conversation.userId !== userId) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const content = msg.content.replace(/^<!--\s*mode:\w+\s*-->\s*\n?/, "");
      const allArtifacts: any[] = Array.isArray(msg.artifacts) ? msg.artifacts : [];

      const artifactIndex = typeof req.body.artifactIndex === "number" ? req.body.artifactIndex : null;
      const artifacts = artifactIndex !== null && artifactIndex >= 0 && artifactIndex < allArtifacts.length
        ? [allArtifacts[artifactIndex]]
        : allArtifacts;

      const singleArtifact = artifactIndex !== null ? artifacts[0] : null;
      const defaultTitle = singleArtifact?.title || content.split("\n").find((l: string) => l.trim())?.replace(/^#+\s*/, "").slice(0, 100) || "Financial Model";
      const title = req.body.title || defaultTitle;

      const sections: any[] = [];
      const assumptions: any[] = [];
      const sources: any[] = [];

      for (const artifact of artifacts) {
        if (artifact.type === "table") {
          sections.push({
            type: "table",
            title: artifact.title || "Data",
            columns: artifact.columns || [],
            data: artifact.data || [],
          });
        } else if (artifact.type === "metric_cards") {
          sections.push({
            type: "metrics",
            title: artifact.title || "Key Metrics",
            data: artifact.data || [],
          });
        } else if (artifact.type === "chart") {
          sections.push({
            type: "chart",
            title: artifact.title || "Chart",
            subtitle: artifact.subtitle,
            source: artifact.source,
            chartConfig: artifact.chartConfig || {},
            data: artifact.data || [],
          });
        } else if (artifact.type === "comparison") {
          sections.push({
            type: "comparison",
            title: artifact.title || "Comparison",
            left: artifact.left,
            right: artifact.right,
          });
        } else if (artifact.type === "callout") {
          if (artifact.variant === "insight" || artifact.variant === "catch") {
            assumptions.push({ text: artifact.text, title: artifact.title, variant: artifact.variant });
          } else {
            sections.push({ type: "callout", title: artifact.title, text: artifact.text, variant: artifact.variant });
          }
        }
      }

      const urlRegex = /\bhttps?:\/\/[^\s\)]+/g;
      const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g;
      const seenUrls = new Set<string>();
      let match;
      while ((match = linkRegex.exec(content)) !== null) {
        if (!seenUrls.has(match[2])) {
          sources.push({ label: match[1], url: match[2] });
          seenUrls.add(match[2]);
        }
      }
      while ((match = urlRegex.exec(content)) !== null) {
        if (!seenUrls.has(match[0])) {
          sources.push({ label: match[0], url: match[0] });
          seenUrls.add(match[0]);
        }
      }

      const assumptionPatterns = [
        /(?:assum|key assumption|we assume|our assumption|baseline assumption)[:\s]+([^\n]+)/gi,
        /(?:bear case|base case|bull case)[:\s]+([^\n]+)/gi,
      ];
      for (const pattern of assumptionPatterns) {
        let aMatch;
        while ((aMatch = pattern.exec(content)) !== null) {
          const text = aMatch[1].trim();
          if (text.length > 10 && text.length < 500) {
            const existing = assumptions.find(a => a.text === text);
            if (!existing) assumptions.push({ text, title: "Assumption", variant: "assumption" });
          }
        }
      }

      const scenarioRegex = /###?\s*(bear|base|bull)\s*(case|scenario)/gi;
      const scenarioMatches: { type: string; startIdx: number; headerLen: number }[] = [];
      let sMatch;
      while ((sMatch = scenarioRegex.exec(content)) !== null) {
        scenarioMatches.push({ type: sMatch[1].toLowerCase(), startIdx: sMatch.index, headerLen: sMatch[0].length });
      }
      if (scenarioMatches.length > 0) {
        const scenarioSection = { type: "scenarios" as const, title: "Scenario Analysis", scenarios: [] as any[] };
        for (let si = 0; si < scenarioMatches.length; si++) {
          const sm = scenarioMatches[si];
          const bodyStart = sm.startIdx + sm.headerLen;
          const bodyEnd = si + 1 < scenarioMatches.length ? scenarioMatches[si + 1].startIdx : Math.min(bodyStart + 1000, content.length);
          const nextHeaderInSlice = content.slice(bodyStart, bodyEnd).match(/^###?\s/m);
          const actualEnd = nextHeaderInSlice && nextHeaderInSlice.index !== undefined ? bodyStart + nextHeaderInSlice.index : bodyEnd;
          const scenarioContent = content.slice(bodyStart, actualEnd).trim().split("\n").filter(l => l.trim()).slice(0, 10);
          scenarioSection.scenarios.push({ type: sm.type, lines: scenarioContent });
        }
        if (scenarioSection.scenarios.length > 0) sections.push(scenarioSection);
      }

      const model = await storage.createFinancialModel({
        userId,
        title,
        subtitle: conversation.title || undefined,
        sourceMessageId: msgId,
        sourceConversationId: msg.conversationId,
        sections,
        assumptions,
        sources,
      });

      res.json({ id: model.id, title: model.title });
    } catch (e: any) {
      console.error("[save-as-model] failed:", e);
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/research/charts/save", requireAuth, async (req, res) => {
    try {
      const { title, chartType, chartConfig, data, description } = req.body;
      if (!title || !data) {
        return res.status(400).json({ message: "Title and data are required" });
      }

      const { dashboardCharts } = await import("@shared/schema");
      const { db: dbImport } = await import("../db");
      const [chart] = await dbImport.insert(dashboardCharts).values({
        userId: req.user!.id,
        title,
        description: description || null,
        chartType: chartType || "line",
        dataSource: "session",
        dataSourceConfig: JSON.stringify({ source: "session_research" }),
        chartConfig: JSON.stringify(chartConfig || {}),
        data: JSON.stringify(data),
        status: "complete",
      }).returning();

      res.json({ id: chart.id, title: chart.title });
    } catch (e: any) {
      console.error("[save-chart] failed:", e);
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/research/charts/saved", requireAuth, async (req, res) => {
    try {
      const { dashboardCharts } = await import("@shared/schema");
      const { db: dbImport } = await import("../db");
      const { eq, desc, sql: sqlOp } = await import("drizzle-orm");
      const charts = await dbImport.select({
        id: dashboardCharts.id,
        title: dashboardCharts.title,
        chartType: dashboardCharts.chartType,
        createdAt: dashboardCharts.createdAt,
      }).from(dashboardCharts)
        .where(eq(dashboardCharts.userId, req.user!.id))
        .orderBy(desc(dashboardCharts.createdAt))
        .limit(50);
      res.json(charts);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/research/charts/:id", requireAuth, async (req, res) => {
    try {
      const { dashboardCharts } = await import("@shared/schema");
      const { db: dbImport } = await import("../db");
      const { eq, and } = await import("drizzle-orm");
      await dbImport.delete(dashboardCharts)
        .where(and(eq(dashboardCharts.id, req.params.id), eq(dashboardCharts.userId, req.user!.id)));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/models", requireAuth, async (req, res) => {
    try {
      const models = await storage.getFinancialModels(req.user!.id);
      res.json({ models });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/models/:id", requireAuth, async (req, res) => {
    try {
      const model = await storage.getFinancialModel(req.params.id);
      if (!model) return res.status(404).json({ message: "Model not found" });
      if (model.userId !== req.user!.id) return res.status(403).json({ message: "Not authorized" });
      res.json(model);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/models/:id", requireAuth, async (req, res) => {
    try {
      const deleted = await storage.deleteFinancialModel(req.params.id, req.user!.id);
      if (!deleted) return res.status(404).json({ message: "Model not found" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/analyst/overview", requireAuth, async (_req, res) => {
    try {
      const { getAnalystOverviews } = await import("../analyst-corpus");
      const { ANALYST_DISPLAY } = await import("@shared/schema");
      const overviews = await getAnalystOverviews();
      res.json({
        analysts: overviews.map((o) => ({ ...o, displayName: ANALYST_DISPLAY[o.analyst] })),
      });
    } catch (e: any) {
      console.error("[analyst/overview] failed:", e);
      res.status(500).json({ message: e.message || "Failed to load analyst overview" });
    }
  });

  app.get("/api/analyst/:name/frameworks", requireAuth, async (req, res) => {
    try {
      const { listAnalystFrameworks } = await import("../analyst-corpus");
      const items = await listAnalystFrameworks(req.params.name);
      res.json({ items });
    } catch (e: any) {
      console.error("[analyst/frameworks] failed:", e);
      res.status(500).json({ message: e.message || "Failed to load frameworks" });
    }
  });

  app.get("/api/analyst/:name/documents", requireAuth, async (req, res) => {
    try {
      const { listAnalystDocuments } = await import("../analyst-corpus");
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const limit = req.query.limit ? Math.max(1, parseInt(String(req.query.limit), 10) || 30) : 30;
      const offset = req.query.offset ? Math.max(0, parseInt(String(req.query.offset), 10) || 0) : 0;
      const data = await listAnalystDocuments({ analyst: req.params.name, q, limit, offset });
      res.json(data);
    } catch (e: any) {
      console.error("[analyst/documents] failed:", e);
      res.status(500).json({ message: e.message || "Failed to load documents" });
    }
  });

  app.get("/api/pipeline-brain", requireAuth, async (req, res) => {
    try {
      const { derivePipelineBrain } = await import("../pipeline-brain");
      const data = await derivePipelineBrain(req.user!.id);
      res.json(data);
    } catch (e: any) {
      console.error("[pipeline-brain] derivation failed:", e);
      res.status(500).json({ message: e.message || "Failed to derive pipeline brain" });
    }
  });

  app.get("/api/data-brain/stats", requireAuth, async (_req, res) => {
    try {
      const { getStats } = await import("../data-source-brain/db");
      const stats = await getStats();
      const provenCount = await db.execute(sql`SELECT COUNT(*) as cnt FROM proven_queries WHERE is_active = true`);
      const provenByProtocol = await db.execute(sql`SELECT protocol, COUNT(*) as cnt, MAX(success_count) as max_success FROM proven_queries WHERE is_active = true GROUP BY protocol ORDER BY cnt DESC LIMIT 30`);
      const learningsCount = await db.execute(sql`SELECT COUNT(*) as cnt FROM system_learnings WHERE is_active = true`);
      const learningsByScope = await db.execute(sql`SELECT scope, COUNT(*) as cnt FROM system_learnings WHERE is_active = true GROUP BY scope ORDER BY cnt DESC`);
      res.json({
        facts: stats,
        provenQueries: {
          total: Number((provenCount as any).rows?.[0]?.cnt || 0),
          byProtocol: (provenByProtocol as any).rows || [],
        },
        systemLearnings: {
          total: Number((learningsCount as any).rows?.[0]?.cnt || 0),
          byScope: (learningsByScope as any).rows || [],
        },
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/data-brain/proven-queries", requireAuth, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const protocol = req.query.protocol as string | undefined;
      const where = protocol
        ? sql`WHERE is_active = true AND protocol ILIKE ${'%' + protocol + '%'}`
        : sql`WHERE is_active = true`;
      const rows = await db.execute(sql`SELECT id, protocol, metric_type, sql_query, chart_type, success_count, fail_count, last_used, created_at FROM proven_queries ${where} ORDER BY success_count DESC, last_used DESC LIMIT ${limit}`);
      res.json((rows as any).rows || []);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/data-brain/facts", requireAuth, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const source = req.query.source as string | undefined;
      const where = source
        ? sql`WHERE source = ${source}`
        : sql``;
      const rows = await db.execute(sql`SELECT id, source, scope, scope_ref, category, content, confidence, source_of_fact, observed_count, created_at, last_seen_at FROM data_source_facts ${where} ORDER BY last_seen_at DESC LIMIT ${limit}`);
      res.json((rows as any).rows || []);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/data-brain/learnings", requireAuth, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const rows = await db.execute(sql`SELECT id, scope, scope_key, rule_type, rule_text, confidence, source, applied_count, is_active, created_at FROM system_learnings WHERE is_active = true ORDER BY applied_count DESC, created_at DESC LIMIT ${limit}`);
      res.json((rows as any).rows || []);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
