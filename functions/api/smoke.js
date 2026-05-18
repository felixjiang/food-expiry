function jsonHeaders() {
  return {
    'content-type': 'application/json; charset=UTF-8',
    'cache-control': 'no-store',
  }
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
