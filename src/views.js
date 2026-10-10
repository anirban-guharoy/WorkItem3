const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
body{font:15px system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#222}
.tc{border:1px solid #ddd;border-radius:8px;padding:1rem;margin:1rem 0}
.tag{display:inline-block;background:#eef;border-radius:4px;padding:1px 8px;margin-right:6px;font-size:12px}
.status{font-weight:600}button{padding:.5rem 1rem;margin-right:.5rem;cursor:pointer}
textarea{width:100%;height:4rem}.muted{color:#777}
</style></head><body>${body}</body></html>`;

export function listView(reviews) {
  const rows = reviews
    .map(
      (r) =>
        `<li><a href="/reviews/${esc(r.key)}">${esc(r.key)}</a> - ${esc(r.story?.summary)} <span class="tag">${esc(r.status)}</span></li>`,
    )
    .join("");
  return page("Manual Tester reviews", `<h1>Manual Tester - reviews</h1><ul>${rows || "<li class='muted'>None yet</li>"}</ul>`);
}

export function reviewView(r) {
  let content;
  if (r.status === "processing") {
    content = `<p>The agent is working on this story... <a href="">refresh</a></p><meta http-equiv="refresh" content="5">`;
  } else if (r.status === "failed") {
    content = `<p>Generation failed: <code>${esc(r.error)}</code></p>`;
  } else {
    const o = r.output;
    content = `<p>${esc(o.summary)}</p>
${o.assumptions.length ? `<h3>Assumptions / open questions</h3><ul>${o.assumptions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
${o.contextSources.length ? `<h3>Context used</h3><ul>${o.contextSources.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
<h2>Test cases (${o.testCases.length})</h2>
${o.testCases
  .map(
    (t) => `<div class="tc"><h3>${esc(t.id)}: ${esc(t.title)}</h3>
<span class="tag">${esc(t.type)}</span><span class="tag">${esc(t.priority)}</span>
<p class="muted">Covers: ${esc(t.acceptanceCriterion)}</p>
${t.preconditions.length ? `<b>Preconditions</b><ul>${t.preconditions.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
<b>Steps</b><ol>${t.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
<b>Expected result</b><p>${esc(t.expectedResult)}</p></div>`,
  )
  .join("")}
<form method="post" action="/reviews/${esc(r.key)}/decision">
<textarea name="comment" placeholder="Reviewer comments">${esc(r.reviewerComment || "")}</textarea><br>
<button name="decision" value="approved">Approve</button>
<button name="decision" value="rejected">Reject</button>
<button formaction="/reviews/${esc(r.key)}/regenerate">Regenerate</button></form>`;
  }
  return page(`${r.key} test cases`, `<p><a href="/reviews">&larr; all reviews</a></p>
<h1>${esc(r.key)}: ${esc(r.story?.summary)}</h1>
<p>Status: <span class="status">${esc(r.status)}</span> ${r.story?.url ? `| <a href="${esc(r.story.url)}">Open in JIRA</a>` : ""}</p>${content}`);
}
