// /api/save-settings.js
// Persists profile + highlight settings INTO Notion itself, as a hidden row
// named "⚙️ Widget Settings" inside the same database. This makes Notion the
// single source of truth — no localStorage, no separate config store.

const {
  extractDatabaseId,
  formatDashedId,
  resolveDataSourceId,
  queryDataSource,
  SETTINGS_ROW_NAME,
} = require("./_notionHelpers");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ success: false, error: "Method not allowed" });
    return;
  }

  try {
    const { token, pageUrl, profile } = req.body || {};
    if (!token || !pageUrl || !profile) {
      res.status(400).json({ success: false, error: "Missing token, pageUrl, or profile data." });
      return;
    }

    const rawId = extractDatabaseId(pageUrl);
    const databaseId = formatDashedId(rawId);
    const resolved = await resolveDataSourceId(databaseId, token);
    if (!resolved.dataSourceId) {
      res.status(400).json({ success: false, error: resolved.error });
      return;
    }

    const queried = await queryDataSource(resolved.dataSourceId, token);
    if (queried.error) {
      res.status(400).json({ success: false, error: queried.error });
      return;
    }

    const settingsPage = queried.results.find((page) => {
      const titleProp = Object.values(page.properties).find((p) => p.type === "title");
      return (titleProp?.title?.[0]?.plain_text || "") === SETTINGS_ROW_NAME;
    });

    const settingsJson = JSON.stringify(profile);

    // Figure out the title property key and a rich_text property key to store JSON in.
    const sampleProps = settingsPage
      ? settingsPage.properties
      : queried.results[0]?.properties || {};

    let titleKey = Object.keys(sampleProps).find((k) => sampleProps[k].type === "title") || "Name";
    let richTextKey = Object.keys(sampleProps).find(
      (k) => sampleProps[k].type === "rich_text" && /settings/i.test(k)
    );
    if (!richTextKey) {
      richTextKey = Object.keys(sampleProps).find((k) => sampleProps[k].type === "rich_text");
    }
    if (!richTextKey) {
      res.status(400).json({
        success: false,
        error: "Your database needs at least one Text property (e.g. add a property called 'Settings JSON', type Text) so settings can be stored in Notion.",
      });
      return;
    }

    const propertiesPayload = {
      [titleKey]: { title: [{ text: { content: SETTINGS_ROW_NAME } }] },
      [richTextKey]: { rich_text: [{ text: { content: settingsJson } }] },
    };

    let notionRes;
    if (settingsPage) {
      notionRes = await fetch(`https://api.notion.com/v1/pages/${settingsPage.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2025-09-03",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ properties: propertiesPayload }),
      });
    } else {
      notionRes = await fetch(`https://api.notion.com/v1/pages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2025-09-03",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          parent: { type: "data_source_id", data_source_id: resolved.dataSourceId },
          properties: propertiesPayload,
        }),
      });
    }

    const notionData = await notionRes.json();
    if (!notionRes.ok) {
      res.status(notionRes.status).json({ success: false, error: notionData?.message || "Could not save settings to Notion." });
      return;
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message || "Unexpected server error." });
  }
};
