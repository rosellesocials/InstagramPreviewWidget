// /api/reorder.js
// Writes new Order values back to Notion after a drag-and-drop reorder in the
// widget. Requires the database to have a Number property containing "Order"
// in its name (e.g. "Order"). If it doesn't exist yet, this will error with a
// clear message telling the user to add it.

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ success: false, error: "Method not allowed" });
    return;
  }

  try {
    const { token, updates, orderPropertyName } = req.body || {};
    if (!token || !Array.isArray(updates)) {
      res.status(400).json({ success: false, error: "Missing token or updates array." });
      return;
    }

    const propName = orderPropertyName || "Order";

    const results = await Promise.all(
      updates.map(async ({ id, order }) => {
        const r = await fetch(`https://api.notion.com/v1/pages/${id}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Notion-Version": "2025-09-03",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            properties: { [propName]: { number: order } },
          }),
        });
        const data = await r.json();
        return { id, ok: r.ok, error: data?.message };
      })
    );

    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      res.status(400).json({
        success: false,
        error:
          "Could not update some rows. Make sure your database has a Number property named '" +
          propName +
          "'. Details: " +
          (failed[0]?.error || "unknown"),
      });
      return;
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message || "Unexpected server error." });
  }
};
