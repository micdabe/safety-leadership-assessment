// netlify/functions/get-results.js
exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-admin-password",
    "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  // 1. Verifica la Password Admin inviata dalla Dashboard
  const clientPassword = event.headers["x-admin-password"] || "";
  const serverPassword = process.env.ADMIN_PASSWORD;

  if (!serverPassword) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Variabile ADMIN_PASSWORD non configurata su Netlify." })
    };
  }

  if (clientPassword !== serverPassword) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: "Password errata. Accesso negato." })
    };
  }

  // 2. Recupera il Token API e il Site ID dalle variabili di Netlify
  const apiToken = process.env.NETLIFY_API_TOKEN;
  const siteId = process.env.SITE_ID;

  if (!apiToken || !siteId) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Variabile NETLIFY_API_TOKEN o SITE_ID mancante su Netlify." })
    };
  }

  try {
    // ========================================================================
    // CASO A: ELIMINAZIONE DI UN SINGOLO TEST (DELETE)
    // ========================================================================
    if (event.httpMethod === "DELETE") {
      const queryId = event.queryStringParameters && event.queryStringParameters.id;
      let bodyId = null;
      if (!queryId && event.body) {
        try {
          bodyId = JSON.parse(event.body).id;
        } catch (_) {}
      }
      const submissionId = queryId || bodyId;

      if (!submissionId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "ID del test (submission_id) mancante." })
        };
      }

      const delResponse = await fetch(
        `https://api.netlify.com/api/v1/submissions/${encodeURIComponent(submissionId)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${apiToken}` }
        }
      );

      if (!delResponse.ok && delResponse.status !== 204) {
        throw new Error(`Impossibile eliminare il test da Netlify (HTTP ${delResponse.status})`);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          status: "deleted",
          deletedId: submissionId
        })
      };
    }

    // ========================================================================
    // CASO B: LETTURA DI TUTTI I TEST (GET)
    // ========================================================================
    let allSubmissions = [];
    let page = 1;
    let keepFetching = true;

    while (keepFetching && page <= 10) {
      const apiUrl = `https://api.netlify.com/api/v1/sites/${siteId}/submissions?per_page=100&page=${page}`;
      const response = await fetch(apiUrl, {
        headers: { Authorization: `Bearer ${apiToken}` }
      });

      if (!response.ok) {
        throw new Error(`Errore API Netlify: HTTP ${response.status}`);
      }

      const batch = await response.json();
      allSubmissions = allSubmissions.concat(batch);

      if (batch.length < 100) {
        keepFetching = false;
      } else {
        page++;
      }
    }

    // Include submission_id (sub.id) per consentire l'eliminazione mirata
    const formattedRows = allSubmissions
      .filter(sub => sub.form_name === "risultati-safety-leadership" && sub.data)
      .map(sub => ({
        submission_id: sub.id,
        created_at: sub.created_at,
        ...sub.data
      }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: "success",
        count: formattedRows.length,
        rows: formattedRows
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};