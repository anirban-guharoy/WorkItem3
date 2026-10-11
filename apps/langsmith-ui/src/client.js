import {
  InteractionRequiredAuthError,
  PublicClientApplication,
} from "@azure/msal-browser";

const byId = (id) => document.getElementById(id);
const loginButton = byId("login");
const logoutButton = byId("logout");
const refreshButton = byId("refresh");
const userLabel = byId("user");
const notice = byId("notice");
const cards = byId("agents");
const manualReviews = byId("manual-reviews");
const agentsPanel = byId("agents-panel");
const reviewPanel = byId("review-panel");
let msal;
let settings;
let capabilities;

function showNotice(message, error = false) {
  notice.textContent = message;
  notice.className = error ? "notice error" : "notice";
}

function statusLabel(status) {
  const label = document.createElement("span");
  label.className = `badge ${status}`;
  label.textContent = status;
  return label;
}

function field(label, value) {
  const row = document.createElement("p");
  const title = document.createElement("strong");
  title.textContent = `${label}: `;
  row.append(title, document.createTextNode(value));
  return row;
}

async function getToken(scope, usePopup = false) {
  const account = msal.getActiveAccount();
  if (!account) throw new Error("Sign in is required.");
  try {
    const result = await msal.acquireTokenSilent({ account, scopes: [scope] });
    return result.accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      if (usePopup) {
        const result = await msal.acquireTokenPopup({ account, scopes: [scope] });
        return result.accessToken;
      }
      await msal.acquireTokenRedirect({ account, scopes: [scope] });
      return undefined;
    }
    throw error;
  }
}

async function fetchAgentStatus(agent) {
  const card = document.createElement("article");
  card.className = "card";
  const title = document.createElement("h2");
  title.textContent = agent.name;
  const state = document.createElement("div");
  state.className = "card-state";
  state.append(statusLabel("checking"));
  card.append(title, state);
  cards.append(card);

  try {
    if (!agent.baseUrl || !agent.scope) throw new Error("Agent API configuration is incomplete.");
    const token = await getToken(agent.scope);
    if (!token) return card;
    const response = await fetch(`${agent.baseUrl}/api/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Agent status returned HTTP ${response.status}`);
    const status = await response.json();
    state.replaceChildren(statusLabel(status.status));
    card.append(
      field("Last checked", new Date(status.checkedAt).toLocaleString()),
      field("LangSmith tracing", status.langsmith.tracing ? `enabled (${status.langsmith.project})` : "disabled"),
    );
    if (keyForAgent(agent) === "wpfSreAgent") {
      await appendWpfAzureHealth(agent, token, card);
    }
    return card;
  } catch (error) {
    state.replaceChildren(statusLabel("unavailable"));
    card.append(field("Details", error.message));
  }
  return card;
}

function keyForAgent(agent) {
  return Object.keys(settings.agents).find((key) => settings.agents[key] === agent);
}

async function appendWpfAzureHealth(agent, token, card) {
  const health = document.createElement("section");
  health.className = "run";
  health.append(field("Azure health", "Loading from Backstage…"));
  card.append(health);
  try {
    const response = await fetch(`${agent.baseUrl}/api/azure/health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Backstage health returned HTTP ${response.status}`);
    health.replaceChildren(field("Azure health (Backstage)", JSON.stringify(result.health)));
  } catch (error) {
    health.replaceChildren(field("Azure health (Backstage)", error.message));
  }
}

async function fetchLatestRun(key, agent, card) {
  const runInfo = document.createElement("section");
  runInfo.className = "run";
  runInfo.append(field("Latest LangSmith run", "Loading..."));
  card.append(runInfo);
  try {
    const token = await getToken(settings.dashboardScope);
    if (!token) return;
    const response = await fetch(`/api/runs/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `LangSmith returned HTTP ${response.status}`);
    runInfo.replaceChildren();
    if (!result.run) {
      runInfo.append(field("Latest LangSmith run", `No runs yet (${result.project})`));
      return;
    }
    runInfo.append(
      field("Latest run", result.run.name),
      field("Run status", result.run.status),
      field("Started", result.run.startedAt ? new Date(result.run.startedAt).toLocaleString() : "unknown"),
    );
    if (result.run.endedAt) runInfo.append(field("Ended", new Date(result.run.endedAt).toLocaleString()));
  } catch (error) {
    runInfo.replaceChildren(field("LangSmith status", error.message));
  }
}

function appendList(parent, title, entries) {
  if (!entries?.length) return;
  const heading = document.createElement("h4");
  heading.textContent = title;
  const list = document.createElement("ul");
  for (const entry of entries) {
    const item = document.createElement("li");
    item.textContent = entry;
    list.append(item);
  }
  parent.append(heading, list);
}

function renderTestCase(testCase) {
  const article = document.createElement("article");
  article.className = "test-case";
  const heading = document.createElement("h4");
  heading.textContent = `${testCase.id}: ${testCase.title}`;
  article.append(heading, field("Type", testCase.type), field("Priority", testCase.priority));
  article.append(field("Acceptance criterion", testCase.acceptanceCriterion));
  appendList(article, "Preconditions", testCase.preconditions);
  appendList(article, "Steps", testCase.steps);
  article.append(field("Expected result", testCase.expectedResult));
  return article;
}

function renderManualReview(review) {
  const article = document.createElement("article");
  article.className = "review-item";
  const heading = document.createElement("h3");
  heading.textContent = `${review.key}: ${review.story.summary}`;
  const state = statusLabel(review.status);
  article.append(heading, state, field("Last updated", new Date(review.updatedAt).toLocaleString()));

  if (review.story.description) article.append(field("Story", review.story.description));
  if (review.story.acceptanceCriteria) article.append(field("Acceptance criteria", review.story.acceptanceCriteria));
  article.append(field("Test set", review.output.summary));
  appendList(article, "Assumptions / open questions", review.output.assumptions);
  appendList(article, "Context sources", review.output.contextSources);

  const casesHeading = document.createElement("h4");
  casesHeading.textContent = `Generated test cases (${review.output.testCases.length})`;
  article.append(casesHeading);
  for (const testCase of review.output.testCases) article.append(renderTestCase(testCase));

  if (review.error) article.append(field("Error", review.error));
  if (review.humanReviewHistory?.length) {
    const historyHeading = document.createElement("h4");
    historyHeading.textContent = "Human review outcomes";
    article.append(historyHeading);
    for (const outcome of review.humanReviewHistory) {
      const entry = document.createElement("div");
      entry.className = "review-outcome";
      const reviewer = outcome.reviewer?.name || outcome.reviewer?.username || outcome.reviewer?.id || "Reviewer";
      entry.append(
        field("Decision", outcome.decision),
        field("Reviewer", reviewer),
        field("Recorded", new Date(outcome.decidedAt).toLocaleString()),
      );
      if (outcome.comment) entry.append(field("Comment", outcome.comment));
      article.append(entry);
    }
  }
  if (review.status === "published" && review.xray?.cycle) {
    article.append(field("Xray test cycle", `${review.xray.cycle.name} (${review.xray.cycle.key})`));
  }

  if (["pending_review", "rejected", "approved", "publish_failed", "awaiting_xray_configuration"].includes(review.status)) {
    const comment = document.createElement("textarea");
    comment.setAttribute("aria-label", `Human review comment for ${review.key}`);
    comment.placeholder = "Optional feedback to guide future test generation";
    const actions = document.createElement("div");
    actions.className = "review-actions";
    const approve = document.createElement("button");
    approve.textContent = "Approve (publish to Xray if configured)";
    approve.addEventListener("click", () => submitHumanDecision(review, "approved", comment, article));
    const reject = document.createElement("button");
    reject.className = "reject";
    reject.textContent = "Reject";
    reject.addEventListener("click", () => submitHumanDecision(review, "rejected", comment, article));
    actions.append(approve, reject);
    article.append(comment, actions);
  }
  return article;
}

async function submitHumanDecision(review, decision, comment, article) {
  const agent = settings.agents.manualTester;
  if (decision === "approved" && !window.confirm(`Approve ${review.key} and publish its test cases to Xray?`)) return;
  const buttons = article.querySelectorAll("button");
  buttons.forEach((button) => { button.disabled = true; });
  try {
    if (!agent.reviewScope) throw new Error("Manual Test Agent review scope is not configured.");
    const token = await getToken(agent.reviewScope, true);
    const response = await fetch(`${agent.baseUrl}/api/reviews/${encodeURIComponent(review.key)}/decision`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ decision, comment: comment.value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Review decision returned HTTP ${response.status}`);
    showNotice(decision === "approved" ? "Approval recorded; Xray publication started." : "Rejection recorded.");
    await refresh();
  } catch (error) {
    showNotice(error.message, true);
    buttons.forEach((button) => { button.disabled = false; });
  }
}

async function fetchManualReviews() {
  manualReviews.replaceChildren();
  const agent = settings.agents.manualTester;
  try {
    if (!agent.baseUrl || !agent.scope) throw new Error("Manual Test Agent API configuration is incomplete.");
    const token = await getToken(agent.scope);
    if (!token) return;
    const requestedStory = new URLSearchParams(window.location.search).get("story");
    const query = requestedStory ? `?story=${encodeURIComponent(requestedStory)}` : "";
    const response = await fetch(`${agent.baseUrl}/api/reviews${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Review queue returned HTTP ${response.status}`);
    if (!result.reviews.length) {
      manualReviews.textContent = "No generated test cases are available yet.";
      return;
    }
    for (const review of result.reviews) {
      const item = renderManualReview(review);
      item.id = `review-${review.key}`;
      manualReviews.append(item);
    }
    if (requestedStory) {
      document.getElementById(`review-${requestedStory}`)?.scrollIntoView({ behavior: "smooth" });
    }
  } catch (error) {
    manualReviews.textContent = `Could not load generated test cases: ${error.message}`;
  }
}

async function refresh() {
  cards.replaceChildren();
  const tasks = [];
  if (capabilities.viewAgentStatus) {
    showNotice("Refreshing agent status…");
    const statusTasks = Object.entries(settings.agents).map(async ([key, agent]) => {
      const card = await fetchAgentStatus(agent);
      await fetchLatestRun(key, agent, card);
    });
    tasks.push(...statusTasks);
  }
  if (capabilities.viewGeneratedCases) tasks.push(fetchManualReviews());
  await Promise.all(tasks);
  showNotice(`Updated ${new Date().toLocaleTimeString()}.`);
}

async function loadCapabilities() {
  const token = await getToken(settings.dashboardScope);
  if (!token) return false;
  const response = await fetch("/api/access", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Access check returned HTTP ${response.status}`);
  capabilities = result.capabilities;
  agentsPanel.hidden = !capabilities.viewAgentStatus;
  reviewPanel.hidden = !capabilities.viewGeneratedCases;
  if (!capabilities.viewAgentStatus && !capabilities.viewGeneratedCases) {
    throw new Error("Your account does not have a dashboard role.");
  }
  return true;
}

async function start() {
  settings = await fetch("/config.json").then((response) => {
    if (!response.ok) throw new Error("Dashboard configuration could not be loaded.");
    return response.json();
  });
  if (!settings.tenantId || !settings.clientId) {
    throw new Error("Configure the Entra tenant and dashboard client ID.");
  }
  msal = new PublicClientApplication({
    auth: {
      clientId: settings.clientId,
      authority: `https://login.microsoftonline.com/${settings.tenantId}`,
      redirectUri: window.location.origin,
      postLogoutRedirectUri: window.location.origin,
    },
    cache: { cacheLocation: "sessionStorage" },
  });
  await msal.initialize();
  const redirectResult = await msal.handleRedirectPromise();
  if (redirectResult?.account) msal.setActiveAccount(redirectResult.account);
  if (!msal.getActiveAccount()) {
    const accounts = msal.getAllAccounts();
    if (accounts.length) msal.setActiveAccount(accounts[0]);
  }
  const account = msal.getActiveAccount();
  if (!account) {
    loginButton.hidden = false;
    return;
  }

  userLabel.textContent = account.name || account.username;
  logoutButton.hidden = false;
  refreshButton.hidden = false;
  if (!await loadCapabilities()) return;
  await refresh();
  window.setInterval(refresh, 30_000);
}

loginButton.addEventListener("click", async () => {
  await msal.loginRedirect({ scopes: ["openid", "profile", settings.dashboardScope] });
});
logoutButton.addEventListener("click", async () => msal.logoutRedirect({ account: msal.getActiveAccount() }));
refreshButton.addEventListener("click", refresh);

start().catch((error) => showNotice(error.message, true));
