// netlify/functions/manage-lists.js
const { getStore, connectLambda } = require("@netlify/blobs");

const DEFAULT_LISTS = {
  companies: [
    "General Contractor SpA",
    "Tech Engineering Srl",
    "SafeWorks Costruzioni",
    "Subappalto Elettrico Srl",
    "Subappalto Meccanico SpA",
    "Altra Azienda | Other Company"
  ],
  roles: [
    "Project Manager / Direttore di Progetto | Project Manager",
    "Site Manager / Direttore di Cantiere | Site Manager",
    "Construction Manager | Construction Manager",
    "HSE Manager / RSPP | HSE Manager",
    "HSE Supervisor / ASPP | HSE Supervisor / Officer",
    "Ingegnere di Progetto / Field Engineer | Project / Field Engineer",
    "Supervisore / Preposto | Supervisor / Foreman",
    "Caposquadra | Crew Leader",
    "Tecnico / Operativo di Campo | Field Technician / Operator",
    "Altro Ruolo | Other Role"
  ],
  sites: [
    "Cantiere Nord - Lotto 1 | North Site - Lot 1",
    "Cantiere Sud - Lotto 2 | South Site - Lot 2",
    "Impianto Industriale Centrale | Central Industrial Plant",
    "Polo Logistico & Infrastrutture | Logistics & Infrastructure Hub",
    "Sede Ingegneria / Direzione | Engineering Office / HQ"
  ]
};

// Inizializza lo store passando esplicitamente siteID e token
function initBlobsStore(event) {
  try {
    connectLambda(event);
  } catch (_) {}

  const siteID = process.env.SITE_ID;
  const token = process.env.NETLIFY_API_TOKEN;

  if (siteID && token) {
    return getStore({
      name: "safety-leadership-config",
      siteID: siteID,
      token: token
    });
  }
  return getStore("safety-leadership-config");
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-admin-password",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const store = initBlobsStore(event);

    // 1. LETTURA LISTE (GET)
    if (event.httpMethod === "GET") {
      let savedData = null;
      try {
        savedData = await store.get("dropdown-lists", { type: "json" });
      } catch (blobErr) {
        console.warn("Blobs read fallback:", blobErr.message);
      }

      const activeLists = (savedData && Array.isArray(savedData.companies))
        ? savedData
        : DEFAULT_LISTS;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          status: "success",
          source: savedData ? "netlify-blobs" : "default",
          companies: activeLists.companies,
          roles: activeLists.roles,
          sites: activeLists.sites
        })
      };
    }

    // 2. SALVATAGGIO LISTE (POST)
    if (event.httpMethod === "POST") {
      const clientPassword = event.headers["x-admin-password"] || "";
      const serverPassword = process.env.ADMIN_PASSWORD;

      if (!serverPassword || clientPassword !== serverPassword) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ error: "Password Admin non valida. Salvataggio rifiutato." })
        };
      }

      const payload = JSON.parse(event.body || "{}");
      const newLists = {
        companies: Array.isArray(payload.companies) && payload.companies.length > 0 ? payload.companies : DEFAULT_LISTS.companies,
        roles: Array.isArray(payload.roles) && payload.roles.length > 0 ? payload.roles : DEFAULT_LISTS.roles,
        sites: Array.isArray(payload.sites) && payload.sites.length > 0 ? payload.sites : DEFAULT_LISTS.sites,
        updatedAt: new Date().toISOString()
      };

      await store.setJSON("dropdown-lists", newLists);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          status: "success",
          message: "Liste salvate correttamente in Netlify Blobs",
          ...newLists
        })
      };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Errore Blobs: " + err.message })
    };
  }
};