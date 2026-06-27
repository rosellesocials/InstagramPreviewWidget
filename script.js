/* ===================== State ===================== */
let currentItems = [];
let currentProfile = null;
let activeFilterTag = null;
let activePostType = "Post";

const CONVENIENCE_KEY = "igGridWidgetConvenience";

function saveConvenience(token, pageUrl) {
  try { localStorage.setItem(CONVENIENCE_KEY, JSON.stringify({ token, pageUrl })); } catch (e) {}
}
function loadConvenience() {
  try { return JSON.parse(localStorage.getItem(CONVENIENCE_KEY) || "{}"); } catch (e) { return {}; }
}

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}

/* ===================== Tabs ===================== */
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

/* ===================== Setup ===================== */
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

/* ===================== Settings tab ===================== */
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
  } catch (e) { /* silent */ }
}

/* ===================== Widget rendering ===================== */
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

  // Profile header
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

  // Toolbar
  html += '<div class="ig-toolbar">';
  html += `<button class="ig-tool-icon" data-action="refresh" title="Refresh">⟳</button>`;
  html += '<div class="ig-tabs">';
  html += `<button class="ig-tab-btn ${activePostType === "Post" ? "active" : ""}" data-posttype="Post">Posts</button>`;
  if (hasReels) html += `<button class="ig-tab-btn ${activePostType === "Reel" ? "active" : ""}" data-posttype="Reel">Reels</button>`;
  html += "</div></div>";

  // Filter items
  const filtered = items.filter((i) => {
    if (i.postType !== activePostType && !(activePostType === "Post" && !i.postType)) return false;
    if (activeFilterTag && i.category !== activeFilterTag) return false;
    return true;
  });

  // Grid — 4:5 portrait cells
  html += '<div class="ig-grid" id="igGridInner">';
  filtered.slice(0, 60).forEach((item, i) => {
    html += `<div class="ig-cell" draggable="true" data-id="${item.id}" title="${escapeHtml(item.title)}${item.date ? " · " + item.date : ""}">`;
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
      } catch (e) { /* ignore transient errors */ }
    });
  }

  wireDragAndDrop(container, containerId, opts);
}

/* ===================== Drag-and-drop reorder =====================
   Strategy:
   - Track the dragged item by its Notion page ID (data-id), not by
     a positional index that goes stale after re-renders.
   - Use dragenter (fires once per cell) instead of dragover (fires
     every few ms) for highlight — smoother, no flicker.
   - dragleave uses relatedTarget to avoid false fires when the mouse
     passes over a child element (image/video/badge).
   - After reorder, sort currentItems by new order before re-rendering
     so the grid doesn't snap back to the old sequence.
================================================================== */
function wireDragAndDrop(container, containerId, opts) {
  const grid = container.querySelector("#igGridInner");
  if (!grid) return;

  // The id of the cell currently being dragged
  let dragSrcId = null;

  function getCells() {
    return Array.from(grid.querySelectorAll(".ig-cell"));
  }

  function clearStyles() {
    getCells().forEach((c) => c.classList.remove("dragging", "drag-over"));
  }

  getCells().forEach((cell) => {

    /* ── dragstart ── */
    cell.addEventListener("dragstart", (e) => {
      dragSrcId = cell.dataset.id;
      e.dataTransfer.effectAllowed = "move";
      // Put the id in the transfer object so drop can read it even if
      // the element reference changes (e.g. after a mid-drag re-render).
      e.dataTransfer.setData("text/plain", dragSrcId);
      // Delay adding the class so the drag ghost captures the normal look
      requestAnimationFrame(() => cell.classList.add("dragging"));
    });

    /* ── dragend ── always fires on the source element ── */
    cell.addEventListener("dragend", () => {
      clearStyles();
      dragSrcId = null;
    });

    /* ── dragenter ── highlight the potential drop target ── */
    cell.addEventListener("dragenter", (e) => {
      e.preventDefault();
      if (cell.dataset.id === dragSrcId) return; // don't highlight source
      clearStyles();
      // Re-add dragging to whichever cell is still the source
      const src = getCells().find((c) => c.dataset.id === dragSrcId);
      if (src) src.classList.add("dragging");
      cell.classList.add("drag-over");
    });

    /* ── dragover ── must preventDefault to allow drop ── */
    cell.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });

    /* ── dragleave ── only clear when truly leaving this cell ── */
    cell.addEventListener("dragleave", (e) => {
      // relatedTarget is where the mouse is going; if it's still inside
      // this cell (e.g. entering a child img), don't remove the class.
      if (!cell.contains(e.relatedTarget)) {
        cell.classList.remove("drag-over");
      }
    });

    /* ── drop ── do the actual reorder ── */
    cell.addEventListener("drop", async (e) => {
      e.preventDefault();
      clearStyles();

      const fromId = e.dataTransfer.getData("text/plain");
      const toId   = cell.dataset.id;
      if (!fromId || fromId === toId) return;

      // Build the new id order from the live DOM
      const ids = getCells().map((c) => c.dataset.id);
      const fromIdx = ids.indexOf(fromId);
      const toIdx   = ids.indexOf(toId);
      if (fromIdx === -1 || toIdx === -1) return;

      // Move fromId to toIdx
      ids.splice(fromIdx, 1);
      ids.splice(toIdx, 0, fromId);

      // Assign new order values and sort currentItems to match
      const newOrder = {};
      ids.forEach((id, i) => { newOrder[id] = i; });

      currentItems = currentItems
        .map((it) => newOrder.hasOwnProperty(it.id) ? { ...it, order: newOrder[it.id] } : it)
        .sort((a, b) => {
          const aIn = newOrder.hasOwnProperty(a.id);
          const bIn = newOrder.hasOwnProperty(b.id);
          if (aIn && bIn) return newOrder[a.id] - newOrder[b.id];
          if (aIn) return -1;
          if (bIn) return  1;
          return 0;
        });

      renderWidget(containerId, opts);

      // Persist to Notion (best-effort)
      if (opts && opts.token) {
        try {
          await fetch("/api/reorder", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token: opts.token,
              updates: ids.map((id, i) => ({ id, order: i })),
            }),
          });
        } catch (_) { /* grid already updated locally */ }
      }
    });
  });
}

/* ===================== Embed mode ===================== */
async function initEmbedMode() {
  document.body.classList.add("embed-mode");

  const params = new URLSearchParams(window.location.search);
  const payload = params.get("c");
  if (!payload) {
    document.getElementById("embedPreview").innerHTML =
      '<div class="preview-empty">Embed link is missing its connection info. Re-copy the embed link from the Setup tab.</div>';
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
