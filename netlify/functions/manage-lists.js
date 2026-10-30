// netlify/functions/manage-lists.js
const { getStore, connectLambda } = require("@netlify/blobs");

const DEFAULT_REPO = "micdabe/safety-leadership-assessment";
const DEFAULT_BRANCH = "main";

// Inizializza il database Netlify Blobs
function getWorkshopDB(event) {
  try { connectLambda(event); } catch (_) {}
  const siteID = process.env.SITE_ID;
  const token = process.env.NETLIFY_API_TOKEN;
  if (siteID && token) {
    return getStore({ name: "safety-leadership-db", siteID, token });
  }
  return getStore("safety-leadership-db");
}

// Legge un file .txt dal repository GitHub
async function getGithubTxtFile(repo, path, branch, token) {
  if (!token) return { exists: false, sha: null, lines: [] };
  const url = `https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "Safety-Leadership-Admin"
    }
  });

  if (!res.ok) return { exists: false, sha: null, lines: [] };

  const data = await res.json();
  const rawText = Buffer.from(data.content, "base64").toString("utf-8");
  const lines = rawText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith("#") && !l.startsWith("//"));

  return { exists: true, sha: data.sha, lines };
}

// Sovrascrive un file .txt nel repository GitHub
async function putGithubTxtFile(repo, path, linesArray, branch, token) {
  const current = await getGithubTxtFile(repo, path, branch, token);
  const textContent = linesArray.join("\n") + "\n";
  const base64Content = Buffer.from(textContent, "utf-8").toString("base64");

  const bodyPayload = {
    message: `Aggiornamento ${path} da Dashboard Admin`,
    content: base64Content,
    branch: branch
  };
  if (current.sha) bodyPayload.sha = current.sha;

  const url = `https://api.github.com/repos/${repo}/contents/${path}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      "User-Agent": "Safety-Leadership-Admin"
    },
    body: JSON.stringify(bodyPayload)
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(`Errore GitHub su ${path} (HTTP ${res.status}): ${errData.message || ""}`);
  }
  return await res.json();
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

  const githubToken = (process.env.GITHUB_TOKEN || "").trim();
  const githubRepo = (process.env.GITHUB_REPO || DEFAULT_REPO).trim();
  const githubBranch = (process.env.GITHUB_BRANCH || DEFAULT_BRANCH).trim();

  try {
    const dbStore = getWorkshopDB(event);

    // ========================================================================
    // 1. LETTURA GLOBALE (GET): Liste .txt da GitHub + Workshop dal DB Blobs
    // ========================================================================
    if (event.httpMethod === "GET") {
      const [compFile, roleFile, siteFile, workshopsDB, assignmentsDB] = await Promise.all([
        getGithubTxtFile(githubRepo, "aziende.txt", githubBranch, githubToken),
        getGithubTxtFile(githubRepo, "ruoli.txt", githubBranch, githubToken),
        getGithubTxtFile(githubRepo, "cantieri.txt", githubBranch, githubToken),
        dbStore.get("workshops-records", { type: "json" }).catch(() => []),
        dbStore.get("workshop-assignments", { type: "json" }).catch(() => ({}))
      ]);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          status: "success",
          companies: compFile.lines || [],
          roles: roleFile.lines || [],
          sites: siteFile.lines || [],
          workshops: Array.isArray(workshopsDB) ? workshopsDB : [],
          assignments: assignmentsDB || {}
        })
      };
    }

    // ========================================================================
    // 2. SALVATAGGIO PROTETTO DA ADMIN_PASSWORD (POST)
    // ========================================================================
    if (event.httpMethod === "POST") {
      const clientPassword = (event.headers["x-admin-password"] || "").trim();
      const serverPassword = (process.env.ADMIN_PASSWORD || "").trim();

      if (!serverPassword || clientPassword !== serverPassword) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ error: "Password Admin non valida o mancante." })
        };
      }

      const payload = JSON.parse(event.body || "{}");
      const action = payload.action || "save_txt";

      // Azione A: Crea / Aggiorna / Elimina l'elenco dei Workshop nel Database Netlify Blobs
      if (action === "save_workshops") {
        const workshopsList = Array.isArray(payload.workshops) ? payload.workshops : [];
        await dbStore.setJSON("workshops-records", workshopsList);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            status: "success",
            message: "Workshop salvati nel database Netlify!",
            workshops: workshopsList
          })
        };
      }

      // Azione B: Assegna un questionario già compilato a un Workshop nel Database Netlify Blobs
      if (action === "assign_submission") {
        const currentMap = (await dbStore.get("workshop-assignments", { type: "json" }).catch(() => ({}))) || {};
        if (payload.submissionId) {
          if (payload.workshopId) {
            currentMap[payload.submissionId] = {
              workshopId: payload.workshopId,
              workshopName: payload.workshopName || "",
              workshopDate: payload.workshopDate || "",
              workshopLevel: payload.workshopLevel || "",
              workshopSite: payload.workshopSite || ""
            };
          } else {
            delete currentMap[payload.submissionId];
          }
          await dbStore.setJSON("workshop-assignments", currentMap);
        }
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            status: "success",
            assignments: currentMap
          })
        };
      }

      // Azione C: Salva i 3 file .txt direttamente su GitHub
      if (!githubToken) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: "Variabile GITHUB_TOKEN mancante su Netlify per salvare i file .txt." })
        };
      }

      if (Array.isArray(payload.companies)) {
        await putGithubTxtFile(githubRepo, "aziende.txt", payload.companies, githubBranch, githubToken);
      }
      if (Array.isArray(payload.roles)) {
        await putGithubTxtFile(githubRepo, "ruoli.txt", payload.roles, githubBranch, githubToken);
      }
      if (Array.isArray(payload.sites)) {
        await putGithubTxtFile(githubRepo, "cantieri.txt", payload.sites, githubBranch, githubToken);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          status: "success",
          message: "File aziende.txt, ruoli.txt e cantieri.txt aggiornati su GitHub!"
        })
      };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};