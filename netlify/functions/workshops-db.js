// netlify/functions/workshops-db.js
const { getStore, connectLambda } = require("@netlify/blobs");

function getWorkshopStore(event) {
  try {
    connectLambda(event);
  } catch (_) {}

  const siteID = (process.env.SITE_ID || "").trim();
  const token = (process.env.NETLIFY_API_TOKEN || "").trim();

  if (siteID && token) {
    return getStore({
      name: "safety-workshops-database",
      siteID: siteID,
      token: token
    });
  }
  return getStore("safety-workshops-database");
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-admin-password",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const store = getWorkshopStore(event);

    // ========================================================================
    // 1. LETTURA DATABASE WORKSHOP (GET) - Usata da index.html e dashboard
    // ========================================================================
    if (event.httpMethod === "GET") {
      const qsId = event.queryStringParameters && event.queryStringParameters.id;

      let workshops = await store.get("workshops-list", { type: "json" });
      if (!Array.isArray(workshops)) workshops = [];

      // Se index.html richiede la verifica di un singolo workshop (?id=ws_...)
      if (qsId) {
        const found = workshops.find(w => String(w.id) === String(qsId));
        if (!found) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ status: "not_found", error: "Workshop non trovato nel database." })
          };
        }
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ status: "success", workshop: found })
        };
      }

      // Altrimenti restituisce tutti i workshop e la mappa delle riassegnazioni
      let assignments = await store.get("submission-assignments", { type: "json" });
      if (!assignments || typeof assignments !== "object") assignments = {};

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          status: "success",
          workshops: workshops,
          assignments: assignments
        })
      };
    }

    // ========================================================================
    // VERIFICA PASSWORD ADMIN PER TUTTE LE OPERAZIONI DI SCRITTURA (POST/DELETE)
    // ========================================================================
    const clientPassword = (event.headers["x-admin-password"] || "").trim();
    const serverPassword = (process.env.ADMIN_PASSWORD || "").trim();

    if (!serverPassword || clientPassword !== serverPassword) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: "Password Admin non valida. Operazione sul database rifiutata." })
      };
    }

    // ========================================================================
    // 2. CREAZIONE / AGGIORNAMENTO WORKSHOP O ASSEGNAZIONE QUESTIONARI (POST)
    // ========================================================================
    if (event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const action = payload.action || "";

      // Caso A: Crea o aggiorna un record Workshop nel database
      if (action === "upsert_workshop" && payload.workshop) {
        let workshops = await store.get("workshops-list", { type: "json" });
        if (!Array.isArray(workshops)) workshops = [];

        const ws = payload.workshop;
        const newRecord = {
          id: ws.id || ("ws_" + Date.now().toString(36) + Math.random().toString(36).substring(2, 6)),
          name: String(ws.name || "").trim(),
          date: String(ws.date || "").trim(),
          site: String(ws.site || "").trim(),
          level: String(ws.level || "Baseline").trim(), // "Top manager" | "Second level" | "Baseline"
          createdAt: ws.createdAt || new Date().toISOString()
        };

        const existingIdx = workshops.findIndex(item => item.id === newRecord.id);
        if (existingIdx >= 0) {
          workshops[existingIdx] = newRecord;
        } else {
          workshops.unshift(newRecord);
        }

        await store.setJSON("workshops-list", workshops);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ status: "success", workshop: newRecord, workshops: workshops })
        };
      }

      // Caso B: Assegna / Modifica il Workshop di uno o più questionari già presenti
      if (action === "assign_submission") {
        let assignments = await store.get("submission-assignments", { type: "json" });
        if (!assignments || typeof assignments !== "object") assignments = {};

        const subId = String(payload.submissionId || "").trim();
        const wsId = String(payload.workshopId || "").trim();

        if (subId) {
          if (wsId === "" || wsId === "NONE") {
            delete assignments[subId];
          } else {
            assignments[subId] = wsId;
          }
          await store.setJSON("submission-assignments", assignments);
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ status: "success", assignments: assignments })
        };
      }

      return { statusCode: 400, headers, body: JSON.stringify({ error: "Azione non riconosciuta." }) };
    }

    // ========================================================================
    // 3. ELIMINAZIONE DI UN WORKSHOP DAL DATABASE (DELETE)
    // ========================================================================
    if (event.httpMethod === "DELETE") {
      const wsId = (event.queryStringParameters && event.queryStringParameters.id) || "";
      if (!wsId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "ID Workshop mancante." }) };
      }

      let workshops = await store.get("workshops-list", { type: "json" });
      if (!Array.isArray(workshops)) workshops = [];

      workshops = workshops.filter(w => String(w.id) !== String(wsId));
      await store.setJSON("workshops-list", workshops);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ status: "deleted", workshops: workshops })
      };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Errore Database Workshop: " + err.message })
    };
  }
};