const DEFAULT_DASHBOARD_URL = "https://workspace.replit.app";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "add-to-dealflow",
    title: "Add to Sessions",
    contexts: ["page", "link", "selection"]
  });

  chrome.storage.sync.get("dashboardUrl", (data) => {
    if (!data.dashboardUrl) {
      chrome.storage.sync.set({ dashboardUrl: DEFAULT_DASHBOARD_URL });
    }
  });
});

async function getDashboardUrl() {
  const { dashboardUrl } = await chrome.storage.sync.get("dashboardUrl");
  return (dashboardUrl || DEFAULT_DASHBOARD_URL).replace(/\/$/, "");
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "add-to-dealflow") return;

  const url = info.linkUrl || info.pageUrl;
  const apiUrl = await getDashboardUrl();

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (capturedUrl) => {
      window.postMessage({
        type: "DEALFLOW_SHOW_CARD",
        data: { loading: true, url: capturedUrl, message: "AI Agent team is researching this company..." }
      }, "*");
    },
    args: [url]
  });

  try {
    const response = await fetch(`${apiUrl}/api/companies/enrich-and-create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: url, pipelineStage: "discovered" })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const company = await response.json();

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (data) => {
        window.postMessage({
          type: "DEALFLOW_SHOW_CARD",
          data: {
            success: true,
            company: data.company,
            dashboardUrl: data.dashboardUrl
          }
        }, "*");
      },
      args: [{ company, dashboardUrl: apiUrl }]
    });
  } catch (err) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (errorMsg) => {
        window.postMessage({
          type: "DEALFLOW_SHOW_CARD",
          data: { error: true, message: errorMsg }
        }, "*");
      },
      args: [`Failed to add deal: ${err.message}`]
    });
  }
});
