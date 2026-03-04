const DEFAULT_DASHBOARD_URL = "https://workspace.replit.app";
const dashboardUrlInput = document.getElementById("dashboardUrl");
const saveBtn = document.getElementById("saveBtn");
const statusEl = document.getElementById("status");
const connectionStatusEl = document.getElementById("connectionStatus");

chrome.storage.sync.get("dashboardUrl", (data) => {
  const url = data.dashboardUrl || DEFAULT_DASHBOARD_URL;
  dashboardUrlInput.value = url;
  checkConnection(url);
});

saveBtn.addEventListener("click", async () => {
  let url = dashboardUrlInput.value.trim();
  if (!url) {
    url = DEFAULT_DASHBOARD_URL;
    dashboardUrlInput.value = url;
  }

  if (!url.startsWith("http")) {
    url = "https://" + url;
    dashboardUrlInput.value = url;
  }

  url = url.replace(/\/$/, "");

  saveBtn.disabled = true;
  saveBtn.textContent = "Connecting...";

  try {
    const response = await fetch(`${url}/api/companies`, { method: "GET" });
    if (response.ok) {
      chrome.storage.sync.set({ dashboardUrl: url }, () => {
        showStatus("Connected successfully!", "success");
        showConnected(url);
      });
    } else {
      showStatus(`Connection failed (HTTP ${response.status})`, "error");
      showDisconnected();
    }
  } catch (err) {
    showStatus("Could not reach dashboard. Check the URL.", "error");
    showDisconnected();
  }

  saveBtn.disabled = false;
  saveBtn.textContent = "Save & Connect";
});

async function checkConnection(url) {
  try {
    const response = await fetch(`${url}/api/companies`, { method: "GET" });
    if (response.ok) {
      showConnected(url);
    } else {
      showDisconnected();
    }
  } catch {
    showDisconnected();
  }
}

function showConnected(url) {
  let displayUrl = url;
  try {
    displayUrl = new URL(url).hostname;
  } catch {}
  connectionStatusEl.innerHTML = `
    <div class="connected">
      <span class="dot"></span>
      Connected to ${displayUrl}
    </div>
  `;
}

function showDisconnected() {
  connectionStatusEl.innerHTML = `
    <div class="disconnected">
      <span class="dot"></span>
      Not connected — publish your app first, then reload extension
    </div>
  `;
}

function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}
