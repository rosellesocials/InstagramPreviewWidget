/* ===================== State ===================== */
let currentItems = [];
let currentProfile = null;
let activeFilterTag = null;
let activePostType = "Post"; // "Post" or "Reel" tab inside the grid

const CONVENIENCE_KEY = "igGridWidgetConvenience"; // ONLY token+pageUrl, for the
// person's own browser convenience while filling the form again. The embed
// itself never reads this — it always gets credentials from its own URL.

function saveConvenience(token, pageUrl) {
  try { localStorage.setItem(CONVENIENCE_KEY, JSON.stringify({ token, pageUrl })); } catch (e) {}
}
function loadConvenience() {
  try { return JSON.parse(localStorage.getItem(CONVENIENCE_KEY) || "{}"); } catch (e) { return {}; }
}

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}

/* ===================== Tabs (Setup / Settings) ===================== */
document.querySelectorAll(".nav.tab").forEach((navEl) => {
  navEl.addEventListener("click", () => {
    document.querySelectorAll(".nav.tab").forEach((n) => n.classList.remove("active"));
    navEl.classList.add("active");
    const target = navEl.dataset.tab;
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    document.getElementById(target + "Section").classList.add("active");
    if (target === "settings") loadSettingsTabPreview();
  });
});

/* ===================== Setup: connect & preview ===================== */
function showStatus(elId, msg, type) {
  const el = document.getElementById(elId);
  el.className = "status " + type;
  el.textContent = msg;
}

function buildEmbedUrl(token, pageUrl) {
  const payload = btoa(JSON.stringify({ token, pageUrl }));
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set("embed", "1");
  url.searchParams.set("c", payload);
  return url.toString();
}

async function fetchNotionData(token, pageUrl) {
  const res = await fetch("/api/notion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, pageUrl }),
  });
  let data;
  try { data = await res.json(); } catch (e) {
    throw new Error("Server error — could not read response.");
  }
  if (!res.ok || !data.success) {
    throw new Error(data.error || "Could not connect.");
  }
  return data;
}

document.getElementById("genbtn").addEventListener("click", async () => {
  const token = document.getElementById("token").value.trim();
  const pageUrl = document.getElementById("pageurl").value.trim();
  const btn = document.getElementById("genbtn");

  if (!token) return showStatus("status", "Please enter your Notion integration token.", "error");
  if (!pageUrl) return showStatus("status", "Please enter your Notion page or database URL.", "error");

  btn.disabled = true;
  showStatus("status", "Connecting to your Notion database…", "loading");

  try {
    const data = await fetchNotionData(token, pageUrl);
    currentItems = data.items;
    currentProfile = data.profile;
    showStatus("status", "✓ Connected! " + data.items.length + " items loaded.", "success");
    renderWidget("preview", { token, pageUrl, live: false });

    saveConvenience(token, pageUrl);
    document.getElementById("embedCard").style.display = "block";
    document.getElementById("embedUrl").value = buildEmbedUrl(token, pageUrl);

    // Pre-fill the settings tab with whatever profile is currently live in Notion.
    fillSettingsForm(currentProfile);
  } catch (e) {
    showStatus("status", "Error: " + e.message, "error");
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("copyEmbedBtn").addEventListener("click", (e) => {
  const input = document.getElementById("embedUrl");
  input.select();
  document.execCommand("copy");
  const original = e.target.textContent;
  e.target.textContent = "✓ Copied!";
  setTimeout(() => { e.target.textContent = original; }, 1500);
});

/* ===================== Settings tab: profile + highlights ===================== */
function fillSettingsForm(profile) {
  document.getElementById("igusername").value = profile.username || "";
  document.getElementById("igdisplayname").value = profile.displayName || "";
  document.getElementById("igbio").value = profile.bio || "";
  document.getElementById("iglink").value = profile.link || "";
  document.getElementById("igavatar").value = profile.avatar || "";
  renderHighlightEditor(profile.highlights || []);
}

function renderHighlightEditor(highlights) {
  const list = document.getElementById("highlightsList");
  list.innerHTML = "";
  highlights.forEach((h, i) => list.appendChild(buildHighlightRow(h, i)));
}

function buildHighlightRow(h, index) {
  const row = document.createElement("div");
  row.className = "highlight-row";
  row.dataset.index = index;
  row.innerHTML = `
    <input type="text" class="h-name" placeholder="Name" value="${escapeHtml(h?.name || "")}">
    <input type="url" class="h-cover" placeholder="Cover image URL" value="${escapeHtml(h?.cover || "")}">
    <input type="color" class="h-color" value="${h?.color || "#c0392b"}">
    <button type="button" class="h-remove">✕</button>
  `;
  row.querySelector(".h-remove").addEventListener("click", () => row.remove());
  return row;
}

document.getElementById("addHighlightBtn").addEventListener("click", () => {
  document.getElementById("highlightsList").appendChild(buildHighlightRow({}, Date.now()));
});

function collectHighlightsFromForm() {
  return Array.from(document.querySelectorAll(".highlight-row")).map((row) => ({
    name: row.querySelector(".h-name").value.trim(),
    cover: row.querySelector(".h-cover").value.trim(),
    color: row.querySelector(".h-color").value,
  })).filter((h) => h.name || h.cover);
}

function collectProfileFromForm() {
  return {
    username: document.getElementById("igusername").value.trim() || "@yourusername",
    displayName: document.getElementById("igdisplayname").value.trim() || "Your Display Name",
    bio: document.getElementById("igbio").value.trim(),
    link: document.getElementById("iglink").value.trim(),
    avatar: document.getElementById("igavatar").value.trim(),
    highlights: collectHighlightsFromForm(),
  };
}

document.getElementById("saveSettingsBtn").addEventListener("click", async () => {
  const conv = loadConvenience();
  const token = document.getElementById("token").value.trim() || conv.token;
  const pageUrl = document.getElementById("pageurl").value.trim() || conv.pageUrl;

  if (!token || !pageUrl) {
    return showStatus("settingsStatus", "Connect your database in the Setup tab first.", "error");
  }

  const profile = collectProfileFromForm();
  showStatus("settingsStatus", "Saving to Notion…", "loading");

  try {
    const res = await fetch("/api/save-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, pageUrl, profile }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || "Could not save.");
    showStatus("settingsStatus", "✓ Saved to Notion! The embed will pick this up on its next refresh.", "success");
    currentProfile = profile;
    renderWidget("settingsPreview", { token, pageUrl, live: false });
  } catch (e) {
    showStatus("settingsStatus", "Error: " + e.message, "error");
  }
});

async function loadSettingsTabPreview() {
  const conv = loadConvenience();
  const token = document.getElementById("token").value.trim() || conv.token;
  const pageUrl = document.getElementById("pageurl").value.trim() || conv.pageUrl;
  if (!token || !pageUrl) return;
  try {
    const data = await fetchNotionData(token, pageUrl);
    currentItems = data.items;
    currentProfile = data.profile;
    fillSettingsForm(currentProfile);
    renderWidget("settingsPreview", { token, pageUrl, live: false });
  } catch (e) {
    /* silent — Setup tab already surfaces connection errors */
  }
}

/* ===================== Widget rendering (shared by preview + embed) ===================== */
const DOT_COLORS = ["#c9a87c","#7a4a3a","#1a1a1a","#9b8b7a","#5a4a3a","#b89b7a"];
const CELL_COLORS = ["#f0e0d6","#d6e8f0","#d6f0e0","#f0d6e8","#e8f0d6","#e8d6f0","#f0f0d6","#d6d6f0","#f0d6d6"];

function renderWidget(containerId, opts) {
  const container = document.getElementById(containerId);
  const profile = currentProfile || { username: "@yourusername", displayName: "Your Display Name", highlights: [] };
  const items = currentItems || [];

  const tagSet = [];
  items.forEach((item) => {
    if (item.category && tagSet.indexOf(item.category) === -1) tagSet.push(item.category);
  });
  if (activeFilterTag && tagSet.indexOf(activeFilterTag) === -1) activeFilterTag = null;

  const hasReels = items.some((i) => i.postType === "Reel");

  let html = '<div class="ig-frame">';

  // Profile
  html += '<div class="ig-profile">';
  html += profile.avatar
    ? `<img class="ig-avatar" src="${profile.avatar}" alt="avatar">`
    : `<div class="ig-avatar">${escapeHtml(profile.username).replace("@","").charAt(0).toUpperCase()}</div>`;
  html += '<div>';
  html += `<div class="ig-username">${escapeHtml(profile.username)}</div>`;
  html += `<div class="ig-displayname">${escapeHtml(profile.displayName)}</div>`;
  if (profile.bio) html += `<div class="ig-bio">${escapeHtml(profile.bio)}</div>`;
  if (profile.link) html += `<a class="ig-link" href="${profile.link}" target="_blank">${escapeHtml(profile.link)}</a>`;
  html += "</div></div>";

  // Highlights
  if (profile.highlights && profile.highlights.length > 0) {
    html += '<div class="ig-highlights">';
    profile.highlights.forEach((h) => {
      html += '<div class="ig-highlight">';
      html += `<div class="ig-highlight-ring" style="background:${h.color || "#c0392b"}">`;
      html += h.cover
        ? `<img class="ig-highlight-cover" src="${h.cover}" alt="">`
        : '<div class="ig-highlight-cover"></div>';
      html += "</div>";
      html += `<div class="ig-highlight-label">${escapeHtml(h.name || "")}</div>`;
      html += "</div>";
    });
    html += "</div>";
  }

  // Tag filter dots
  if (tagSet.length > 0) {
    html += '<div class="ig-tags">';
    tagSet.forEach((tag, i) => {
      const isActive = activeFilterTag === tag;
      html += `<button class="ig-tag" data-tag="${escapeHtml(tag)}">`;
      html += `<div class="ig-tag-dot ${isActive ? "active" : ""}" style="background:${DOT_COLORS[i % DOT_COLORS.length]}"></div>`;
      html += `<div class="ig-tag-label">${escapeHtml(tag)}</div>`;
      html += "</button>";
    });
    html += "</div>";
  }

  // Toolbar with Posts/Reels tabs
  html += '<div class="ig-toolbar">';
  html += `<button class="ig-tool-icon" data-action="refresh" title="Refresh">⟳</button>`;
  html += '<div class="ig-tabs">';
  html += `<button class="ig-tab-btn ${activePostType === "Post" ? "active" : ""}" data-posttype="Post">Posts</button>`;
  if (hasReels) html += `<button class="ig-tab-btn ${activePostType === "Reel" ? "active" : ""}" data-posttype="Reel">Reels</button>`;
  html += "</div>";
  html += "</div>";

  // Grid
  const filtered = items.filter((i) => {
    if (i.postType !== activePostType && !(activePostType === "Post" && !i.postType)) return false;
    if (activeFilterTag && i.category !== activeFilterTag) return false;
    return true;
  });

  html += '<div class="ig-grid" id="igGridInner">';
  filtered.slice(0, 60).forEach((item, i) => {
    html += `<div class="ig-cell" draggable="true" data-id="${item.id}" data-idx="${i}" title="${escapeHtml(item.title)}${item.date ? " · " + item.date : ""}">`;
    if (item.image) {
      if (item.isVideo) {
        html += `<video src="${item.image}" muted></video>`;
      } else {
        html += `<img src="${item.image}" alt="${escapeHtml(item.title)}" onerror="this.style.display='none'">`;
      }
    } else {
      html += `<div class="ig-clabel" style="background:${CELL_COLORS[i % 9]}">${escapeHtml((item.title || "Untitled").substring(0, 22))}</div>`;
    }
    if (item.isVideo) html += '<span class="ig-badge">▶</span>';
    if (item.isCarousel) html += '<span class="ig-badge">⧉</span>';
    if (item.date) html += `<span class="ig-dbadge">${item.date.substring(5,10)}</span>`;
    html += "</div>";
  });
  html += "</div></div>";

  container.innerHTML = html;
  wireWidgetInteractions(container, containerId, opts);
}

function wireWidgetInteractions(container, containerId, opts) {
  container.querySelectorAll(".ig-tag").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeFilterTag = activeFilterTag === btn.dataset.tag ? null : btn.dataset.tag;
      renderWidget(containerId, opts);
    });
  });

  container.querySelectorAll(".ig-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activePostType = btn.dataset.posttype;
      renderWidget(containerId, opts);
    });
  });

  const refreshBtn = container.querySelector('[data-action="refresh"]');
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      if (!opts || !opts.token || !opts.pageUrl) return;
      try {
        const data = await fetchNotionData(opts.token, opts.pageUrl);
        currentItems = data.items;
        currentProfile = data.profile;
        renderWidget(containerId, opts);
      } catch (e) { /* ignore transient refresh errors */ }
    });
  }

  wireDragAndDrop(container, containerId, opts);
}

/* ===================== Drag-and-drop reorder ===================== */
function wireDragAndDrop(container, containerId, opts) {
  const grid = container.querySelector("#igGridInner");
  if (!grid) return;
  let dragEl = null;

  grid.querySelectorAll(".ig-cell").forEach((cell) => {
    cell.addEventListener("dragstart", () => {
      dragEl = cell;
      cell.classList.add("dragging");
    });
    cell.addEventListener("dragend", () => {
      cell.classList.remove("dragging");
      grid.querySelectorAll(".ig-cell").forEach((c) => c.classList.remove("drag-over"));
    });
    cell.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (cell !== dragEl) cell.classList.add("drag-over");
    });
    cell.addEventListener("dragleave", () => cell.classList.remove("drag-over"));
    cell.addEventListener("drop", async (e) => {
      e.preventDefault();
      cell.classList.remove("drag-over");
      if (!dragEl || dragEl === cell) return;

      const cells = Array.from(grid.querySelectorAll(".ig-cell"));
      const fromIdx = cells.indexOf(dragEl);
      const toIdx = cells.indexOf(cell);

      // Reorder the in-memory items list (within the currently filtered set's ids).
      const orderedIds = cells.map((c) => c.dataset.id);
      const [movedId] = orderedIds.splice(fromIdx, 1);
      orderedIds.splice(toIdx, 0, movedId);

      // Re-map currentItems' order field based on new sequence, smoothly re-render.
      const idToNewOrder = {};
      orderedIds.forEach((id, i) => { idToNewOrder[id] = i; });
      currentItems = currentItems.map((it) =>
        idToNewOrder.hasOwnProperty(it.id) ? { ...it, order: idToNewOrder[it.id] } : it
      );

      renderWidget(containerId, opts);

      if (opts && opts.token) {
        try {
          await fetch("/api/reorder", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token: opts.token,
              updates: orderedIds.map((id, i) => ({ id, order: i })),
            }),
          });
        } catch (err) { /* best-effort; grid already reflects new order locally */ }
      }
    });
  });
}

/* ===================== Embed mode: always live, never localStorage ===================== */
async function initEmbedMode() {
  document.body.classList.add("embed-mode");

  const params = new URLSearchParams(window.location.search);
  const payload = params.get("c");
  if (!payload) {
    document.getElementById("embedPreview").innerHTML =
      '<div class="preview-empty">This embed link is missing its connection info. Re-copy the embed link from the Setup tab.</div>';
    return;
  }

  let creds;
  try {
    creds = JSON.parse(atob(payload));
  } catch (e) {
    document.getElementById("embedPreview").innerHTML =
      '<div class="preview-empty">Invalid embed link.</div>';
    return;
  }

  const opts = { token: creds.token, pageUrl: creds.pageUrl, live: true };

  async function loadLive() {
    try {
      const data = await fetchNotionData(creds.token, creds.pageUrl);
      currentItems = data.items;
      currentProfile = data.profile;
      renderWidget("embedPreview", opts);
    } catch (e) {
      document.getElementById("embedPreview").innerHTML =
        '<div class="preview-empty">Could not load: ' + escapeHtml(e.message) + "</div>";
    }
  }

  await loadLive();
  // Always-fresh: re-fetch from Notion automatically so edits in the database,
  // Calendar View, or Profile & Highlights tab show up without manual action.
  setInterval(loadLive, 30000);
}

/* ===================== Init ===================== */
(function init() {
  const conv = loadConvenience();
  if (conv.token) document.getElementById("token").value = conv.token;
  if (conv.pageUrl) document.getElementById("pageurl").value = conv.pageUrl;
  if (conv.token && conv.pageUrl) {
    document.getElementById("embedCard").style.display = "block";
    document.getElementById("embedUrl").value = buildEmbedUrl(conv.token, conv.pageUrl);
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get("embed") === "1") {
    initEmbedMode();
  }
})();
