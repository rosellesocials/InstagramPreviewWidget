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
