function jsonHeaders() {
  return {
    'content-type': 'application/json; charset=UTF-8',
    'cache-control': 'no-store',
  }
}

function maskValue(value) {
  if (!value) {
    return null
  }

  if (value.length <= 8) {
    return `${value.slice(0, 2)}***`
  }

  return `${value.slice(0, 4)}***${value.slice(-4)}`
}

export async function onRequest(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        ...jsonHeaders(),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  return new Response(
    JSON.stringify(
      {
        ok: true,
        message: 'Pages Functions smoke test is alive.',
        entry: 'onRequest-request',
        route: '/functions/api/smoke',
        now: new Date().toISOString(),
        checks: {
          hasArkModel: Boolean(process.env.ARK_MODEL),
          hasArkApiKey: Boolean(process.env.ARK_API_KEY),
        },
        values: {
          arkModel: process.env.ARK_MODEL || null,
          arkApiKeyMasked: maskValue(process.env.ARK_API_KEY),
        },
      },
      null,
      2
    ),
    {
      status: 200,
      headers: jsonHeaders(),
    }
  )
}
