import { storage } from "./storage";
import { sendAdminCostAlert } from "./telegram";

export async function checkCostAlert(): Promise<{
  exceeded: boolean;
  todayCost: number;
  threshold: number;
} | null> {
  try {
    let settings = await storage.getCostAlertSettings();
    if (!settings) {
      settings = await storage.upsertCostAlertSettings({ dailyThreshold: 5.0, enabled: true, telegramEnabled: false });
    }
    if (!settings.enabled) return null;

    const todayCost = await storage.getTodayApiCost();
    const today = new Date().toISOString().split("T")[0];

    if (todayCost >= settings.dailyThreshold) {
      if (settings.lastAlertDate !== today) {
        console.log(`[CostAlert] Daily cost $${todayCost.toFixed(4)} exceeded threshold $${settings.dailyThreshold.toFixed(2)}`);

        if (settings.telegramEnabled) {
          await sendAdminCostAlert(todayCost, settings.dailyThreshold);
        }

        await storage.updateCostAlertLastAlertDate(settings.id, today);
      }

      return { exceeded: true, todayCost, threshold: settings.dailyThreshold };
    }

    return { exceeded: false, todayCost, threshold: settings.dailyThreshold };
  } catch (err: any) {
    console.error("[CostAlert] Check failed:", err?.message || err);
    return null;
  }
}
