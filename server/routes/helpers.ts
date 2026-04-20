import { storage } from "../storage";

export async function autoAttachMasterQueries(company: { id: string; name: string; tokenTicker?: string | null; tokenChain?: string | null }) {
  const existing = await storage.getDuneQueries(company.id);
  const existingQueryIds = new Set(existing.map(q => q.queryId));
  const allMaster = await storage.getMasterDuneQueries();

  const companyNameLower = company.name.toLowerCase();
  const ticker = company.tokenTicker?.toLowerCase();
  const chain = company.tokenChain?.toLowerCase();

  let attachCount = 0;
  for (const mq of allMaster) {
    if (existingQueryIds.has(mq.queryId)) continue;
    const tags = (mq.protocolTags || []).map(t => t.toLowerCase());
    const chains = (mq.chainTags || []).map(t => t.toLowerCase());

    const tagMatch = tags.some(t => companyNameLower.includes(t) || (ticker && t === ticker));
    const chainMatch = chain && chains.includes(chain);

    if (tagMatch || chainMatch) {
      await storage.addDuneQuery({
        companyId: company.id,
        queryId: mq.queryId,
        label: mq.label,
        visualizationType: mq.visualizationType,
        displayOrder: existing.length + attachCount,
        masterQueryId: mq.id,
      });
      attachCount++;
    }
  }
  if (attachCount > 0) {
    console.log(`[Auto] Attached ${attachCount} master Dune queries to ${company.name}`);
  }
}

export function buildDuneChartConfig(columns: string[], rows: any[]): any {
  return { columns, _chartType: "table" };
}
