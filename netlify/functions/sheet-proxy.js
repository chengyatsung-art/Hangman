exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ ok: false, message: "Method Not Allowed" })
    };
  }

  const endpoint = process.env.GAS_WEB_APP_URL;
  if (!endpoint) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, message: "Missing GAS_WEB_APP_URL" })
    };
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: event.body || "{}"
    });
    const text = await response.text();
    return {
      statusCode: response.status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: text
    };
  } catch (error) {
    return {
      statusCode: 502,
      body: JSON.stringify({ ok: false, message: "Proxy request failed", detail: error.message })
    };
  }
};
