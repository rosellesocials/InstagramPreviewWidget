cat > /mnt/user-data/outputs/igfeedpreviewwidget/api/_notionHelpers.js << 'EOF'
// /api/_notionHelpers.js
// Uses the STABLE Notion API (2022-06-28) — no data_sources, no experimental endpoints.

const NOTION_VERSION  = "2022-06-28";
const SETTINGS_ROW_NAME = "⚙️ Widget Settings";

/* ── ID helpers ── */
function extractDatabaseId(pageUrl) {
  const m = pageUrl.match(/([a-f0-9]{32})(?:[^a-f0-9]|$)/i)
         || pageUrl.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  if (!m) return null;
  return m[1].replace(/-/g, "");
}

function formatDashedId(id) {
  return `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`;
}

/* ── Property helpers ── */
function getFirstOfType(properties, type) {
  for (const key in properties) {
    if (properties[key]?.type === type) return { key, prop: properties[key] };
  }
  return null;
}

function isImageUrl(url) {
  return /\.(jpg|jpeg|png|gif|webp|avif)(\?|$)/i.test(url || "");
}
function isVideoUrl(url) {
  return /\.(mp4|mov|webm)(\?|$)/i.test(url || "");
}

/* ── Query the database directly (stable API) ── */
async function queryDatabase(databaseId, token, startCursor) {
  const body = { page_size: 100 };
  if (startCursor) body.start_cursor = startCursor;

  const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    let msg = data?.message || data?.code || "Could not query database.";
    if (res.status === 401) msg = "Invalid token — check your Notion integration token.";
    if (res.status === 403) msg = "Access denied — make sure you shared the database with your integration (··· → Connect to).";
    if (res.status === 404) msg = "Database not found — check the URL you pasted.";
    return { error: `(${res.status}) ${msg}` };
  }

  return { results: data.results || [], hasMore: data.has_more, nextCursor: data.next_cursor };
}

/* ── Fetch ALL pages (handles Notion's 100-item pagination) ── */
async function queryAllPages(databaseId, token) {
  let allResults = [];
  let cursor = undefined;

  do {
    const batch = await queryDatabase(databaseId, token, cursor);
    if (batch.error) return { error: batch.error };
    allResults = allResults.concat(batch.results);
    cursor = batch.hasMore ? batch.nextCursor : undefined;
  } while (cursor);

  return { results: allResults };
}

/* ── Map a Notion page row → post item ── */
function getTitleText(properties) {
  const t = getFirstOfType(properties, "title");
  return t?.prop?.title?.[0]?.plain_text || "";
}

function getRichText(properties, preferredNames) {
  for (const name of (preferredNames || [])) {
    for (const key in properties) {
      if (key.toLowerCase() === name.toLowerCase() && properties[key].type === "rich_text") {
        return { key, text: properties[key].rich_text?.[0]?.plain_text || "" };
      }
    }
  }
  const t = getFirstOfType(properties, "rich_text");
  return t ? { key: t.key, text: t.prop.rich_text?.[0]?.plain_text || "" } : { key: null, text: "" };
}

function mapPostRow(page) {
  const props = page.properties;
  const title = getTitleText(props) || "Untitled";

  // Date
  const dateProp = getFirstOfType(props, "date");
  const date = dateProp?.prop?.date?.start || null;

  // Category / tag / pillar
  let category = null;
  for (const key in props) {
    if (props[key].type === "select" && /pillar|category|tag/i.test(key)) {
      category = props[key].select?.name || null;
      break;
    }
  }
  if (!category) {
    const sel = getFirstOfType(props, "select");
    category = sel?.prop?.select?.name || null;
  }

  // Post type (Post / Reel)
  let postType = "Post";
  for (const key in props) {
    if (props[key].type === "select" && /^type$/i.test(key)) {
      postType = props[key].select?.name || "Post";
      break;
    }
  }

  // Order number (used for manual drag-reorder)
  let order = null;
  for (const key in props) {
    if (props[key].type === "number" && /order/i.test(key)) {
      order = props[key].number;
      break;
    }
  }

  // Image — files property first, then URL properties
  const filesProp = getFirstOfType(props, "files");
  let image = null, isVideo = false, isCarousel = false;

  if (filesProp?.prop?.files?.length > 0) {
    const urls = filesProp.prop.files
      .map((f) => f.file?.url || f.external?.url)
      .filter(Boolean);
    if (urls.length > 0) {
      image      = urls[0];
      isCarousel = urls.length > 1;
      isVideo    = isVideoUrl(image);
    }
  }

  // Canva URL support
  let canvaUrl = null, source = null;
  for (const key in props) {
    if (props[key].type === "select" && /source/i.test(key))
      source = props[key].select?.name || null;
    if (props[key].type === "url" && /canva/i.test(key) && props[key].url)
      canvaUrl = props[key].url;
  }

  if (source === "canva" && canvaUrl) {
    image = canvaUrl;
  } else if (!image) {
    for (const key in props) {
      const p = props[key];
      if (p.type === "url" && p.url) {
        if (isImageUrl(p.url) || isVideoUrl(p.url)) {
          image   = p.url;
          isVideo = isVideoUrl(p.url);
          break;
        }
        if (!image) image = p.url;
      }
    }
  }

  return { id: page.id, title, image, date, category, postType, order, isVideo, isCarousel, isCanva: source === "canva" && !!canvaUrl };
}

/* ── Profile / settings row ── */
function defaultProfile() {
  return { username: "@yourusername", displayName: "Your Display Name", bio: "", link: "", avatar: "", highlights: [] };
}

function parseSettingsRow(page) {
  const props = page.properties;
  const rt = getRichText(props, ["Settings JSON", "SettingsJSON", "Settings"]);
  try {
    const parsed = JSON.parse(rt.text || "{}");
    return { ...defaultProfile(), ...parsed, _settingsPropKey: rt.key, _pageId: page.id };
  } catch (e) {
    return { ...defaultProfile(), _settingsPropKey: rt.key, _pageId: page.id };
  }
}

module.exports = {
  SETTINGS_ROW_NAME,
  extractDatabaseId,
  formatDashedId,
  queryAllPages,
  mapPostRow,
  defaultProfile,
  parseSettingsRow,
  getRichText,
};
EOF
Output

exit code 0

Write new clean notion.js
bash

cat > /mnt/user-data/outputs/igfeedpreviewwidget/api/notion.js << 'EOF'
// /api/notion.js
// Stable Notion API (2022-06-28) — no data_sources, no experimental endpoints.

const {
  extractDatabaseId,
  formatDashedId,
  queryAllPages,
  mapPostRow,
  parseSettingsRow,
  defaultProfile,
  SETTINGS_ROW_NAME,
} = require("./_notionHelpers");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ success: false, error: "Method not allowed" });
    return;
  }

  try {
    const { token, pageUrl } = req.body || {};

    if (!token || !pageUrl) {
      res.status(400).json({ success: false, error: "Missing token or page URL." });
      return;
    }

    const rawId = extractDatabaseId(pageUrl);
    if (!rawId) {
      res.status(400).json({ success: false, error: "Could not find a valid database ID in that URL." });
      return;
    }

    const databaseId = formatDashedId(rawId);

    // Query ALL rows (handles pagination automatically)
    const queried = await queryAllPages(databaseId, token);
    if (queried.error) {
      res.status(400).json({ success: false, error: queried.error });
      return;
    }

    // Separate settings row from post rows
    let profile = defaultProfile();
    const postRows = [];

    queried.results.forEach((page) => {
      const titleProp = Object.values(page.properties).find((p) => p.type === "title");
      const titleText = titleProp?.title?.[0]?.plain_text || "";
      if (titleText === SETTINGS_ROW_NAME) {
        profile = parseSettingsRow(page);
      } else {
        postRows.push(page);
      }
    });

    let items = postRows.map(mapPostRow);

    // Sort by Order number if any row has it, otherwise by date ascending
    const hasOrder = items.some((i) => i.order !== null && i.order !== undefined);
    if (hasOrder) {
      items.sort((a, b) => (a.order ?? 999999) - (b.order ?? 999999));
    } else {
      items.sort((a, b) => {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return new Date(a.date) - new Date(b.date);
      });
    }

    res.status(200).json({ success: true, items, profile });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message || "Unexpected server error." });
  }
};

