let cardContainer = null;
let dismissTimeout = null;

function createCard() {
  if (cardContainer) {
    cardContainer.remove();
  }
  cardContainer = document.createElement("div");
  cardContainer.id = "dealflow-agent-card";
  document.body.appendChild(cardContainer);
  return cardContainer;
}

function showLoadingCard(url) {
  const card = createCard();
  let displayUrl = url;
  try {
    displayUrl = new URL(url).hostname;
  } catch {}

  card.innerHTML = `
    <div class="dealflow-card dealflow-card-loading">
      <div class="dealflow-card-header">
        <div class="dealflow-logo">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
        </div>
        <span class="dealflow-title">Sessions</span>
        <button class="dealflow-close" onclick="this.closest('#dealflow-agent-card').remove()">&times;</button>
      </div>
      <div class="dealflow-card-body">
        <div class="dealflow-spinner"></div>
        <p class="dealflow-status">Adding to pipeline...</p>
        <p class="dealflow-url">${displayUrl}</p>
      </div>
    </div>
  `;
}

function showSuccessCard(data) {
  const card = createCard();
  const company = data.company;
  const editUrl = `${data.dashboardUrl}/companies/${company.id}`;

  card.innerHTML = `
    <div class="dealflow-card dealflow-card-success">
      <div class="dealflow-card-header">
        <div class="dealflow-logo">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
        </div>
        <span class="dealflow-title">Added to Sessions</span>
        <button class="dealflow-close" onclick="this.closest('#dealflow-agent-card').remove()">&times;</button>
      </div>
      <div class="dealflow-card-body">
        <div class="dealflow-check">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <h3 class="dealflow-company-name">${company.name}</h3>
        <p class="dealflow-company-oneliner">${company.oneLiner}</p>
        <div class="dealflow-meta">
          <span class="dealflow-badge">Discovered</span>
        </div>
        <a href="${editUrl}" target="_blank" class="dealflow-edit-link">Edit in Dashboard</a>
      </div>
    </div>
  `;

  clearTimeout(dismissTimeout);
  dismissTimeout = setTimeout(() => {
    if (cardContainer) {
      cardContainer.classList.add("dealflow-fade-out");
      setTimeout(() => {
        if (cardContainer) cardContainer.remove();
      }, 300);
    }
  }, 5000);
}

function showErrorCard(message) {
  const card = createCard();
  card.innerHTML = `
    <div class="dealflow-card dealflow-card-error">
      <div class="dealflow-card-header">
        <div class="dealflow-logo dealflow-logo-error">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
        </div>
        <span class="dealflow-title">Sessions</span>
        <button class="dealflow-close" onclick="this.closest('#dealflow-agent-card').remove()">&times;</button>
      </div>
      <div class="dealflow-card-body">
        <p class="dealflow-error-msg">${message}</p>
      </div>
    </div>
  `;

  clearTimeout(dismissTimeout);
  dismissTimeout = setTimeout(() => {
    if (cardContainer) {
      cardContainer.classList.add("dealflow-fade-out");
      setTimeout(() => {
        if (cardContainer) cardContainer.remove();
      }, 300);
    }
  }, 5000);
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (!event.data || event.data.type !== "DEALFLOW_SHOW_CARD") return;

  const { data } = event.data;

  if (data.loading) {
    showLoadingCard(data.url);
  } else if (data.success) {
    showSuccessCard(data);
  } else if (data.error) {
    showErrorCard(data.message);
  }
});
