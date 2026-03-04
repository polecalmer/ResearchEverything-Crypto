chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "add-to-dealflow",
    title: "Add to Dealflow",
    contexts: ["page", "link", "selection"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "add-to-dealflow") return;

  const url = info.linkUrl || info.pageUrl;

  const { dashboardUrl } = await chrome.storage.sync.get("dashboardUrl");
  if (!dashboardUrl) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        window.postMessage({
          type: "DEALFLOW_SHOW_CARD",
          data: {
            error: true,
            message: "Please set your dashboard URL first. Click the Dealflow Agent extension icon."
          }
        }, "*");
      }
    });
    return;
  }

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (capturedUrl) => {
      window.postMessage({
        type: "DEALFLOW_SHOW_CARD",
        data: { loading: true, url: capturedUrl, message: "AI Agent is researching this company..." }
      }, "*");
    },
    args: [url]
  });

  try {
    const apiUrl = dashboardUrl.replace(/\/$/, "");
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
