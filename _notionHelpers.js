// /api/_notionHelpers.js
// Shared utilities for talking to the Notion API across endpoints.

const SETTINGS_ROW_NAME = "⚙️ Widget Settings";

function extractDatabaseId(pageUrl) {
  const match = pageUrl.match(/([a-f0-9]{32})(?:[^a-f0-9]|$)/i) ||
                pageUrl.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  if (!match) return null;
  return match[1].replace(/-/g, "");
}

function formatDashedId(id) {
  return `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`;
}

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

// Resolve a database's data source id (required by Notion API 2025-09-03+).
async function resolveDataSourceId(databaseId, token) {
  const dbRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2025-09-03",
    },
  });
  const dbData = await dbRes.json();
  if (!dbRes.ok) {
    return { error: `(${dbRes.status}) ${dbData?.message || dbData?.code || "Could not retrieve database."}` };
  }
  const dataSourceId = dbData?.data_sources?.[0]?.id;
  if (!dataSourceId) {
    return { error: "Database has no accessible data sources for this integration." };
  }
  return { dataSourceId };
}

async function queryDataSource(dataSourceId, token) {
  const res = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2025-09-03",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ page_size: 100 }),
  });
  const data = await res.json();
  if (!res.ok) {
    return { error: data?.message || "Could not query data source." };
  }
  return { results: data.results || [] };
}

function getTitleText(properties) {
  const t = getFirstOfType(properties, "title");
  return t?.prop?.title?.[0]?.plain_text || "";
}

function getRichText(properties, preferredNames) {
  // Try preferred property names first (case-insensitive), else first rich_text prop.
  for (const name of preferredNames || []) {
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

  const dateProp = getFirstOfType(props, "date");
  const date = dateProp?.prop?.date?.start || null;

  // "Content pillar" style select used as the category/tag.
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

  // "Type" select: Post vs Reel (optional property).
  let postType = "Post";
  for (const key in props) {
    if (props[key].type === "select" && /^type$/i.test(key)) {
      postType = props[key].select?.name || "Post";
      break;
    }
  }

  // Explicit "Order" number property, if present.
  let order = null;
  for (const key in props) {
    if (props[key].type === "number" && /order/i.test(key)) {
      order = props[key].number;
      break;
    }
  }

  const filesProp = getFirstOfType(props, "files");
  let image = null;
  let isVideo = false;
  let isCarousel = false;

  if (filesProp?.prop?.files?.length > 0) {
    const urls = filesProp.prop.files
      .map((f) => f.file?.url || f.external?.url)
      .filter(Boolean);
    if (urls.length > 0) {
      image = urls[0];
      isCarousel = urls.length > 1;
      isVideo = isVideoUrl(image);
    }
  }

  let canvaUrl = null;
  let source = null;
  for (const key in props) {
    if (props[key].type === "select" && /source/i.test(key)) {
      source = props[key].select?.name || null;
    }
    if (props[key].type === "url" && /canva/i.test(key) && props[key].url) {
      canvaUrl = props[key].url;
    }
  }

  if (source === "canva" && canvaUrl) {
    image = canvaUrl;
  } else if (!image) {
    for (const key in props) {
      const p = props[key];
      if (p.type === "url" && p.url) {
        if (isImageUrl(p.url) || isVideoUrl(p.url)) {
          image = p.url;
          isVideo = isVideoUrl(p.url);
          break;
        }
        if (!image) image = p.url;
      }
    }
  }

  return {
    id: page.id,
    title,
    image,
    isCanva: source === "canva" && !!canvaUrl,
    date,
    category,
    postType,
    order,
    isVideo,
    isCarousel,
  };
}

function defaultProfile() {
  return {
    username: "@yourusername",
    displayName: "Your Display Name",
    bio: "",
    link: "",
    avatar: "",
    highlights: [],
  };
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
  getFirstOfType,
  resolveDataSourceId,
  queryDataSource,
  getTitleText,
  getRichText,
  mapPostRow,
  defaultProfile,
  parseSettingsRow,
};
