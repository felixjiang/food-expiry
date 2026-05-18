function readEnv(event, name) {
  const eventValue =
    event &&
    typeof event === 'object' &&
    event.env &&
    typeof event.env === 'object' &&
    typeof event.env[name] === 'string'
      ? event.env[name]
      : null

  const processValue =
    typeof process !== 'undefined' &&
    process &&
    process.env &&
    typeof process.env[name] === 'string'
      ? process.env[name]
      : null

  const globalValue =
    typeof globalThis !== 'undefined' &&
    globalThis &&
    typeof globalThis[name] === 'string'
      ? globalThis[name]
      : null

  return eventValue || processValue || globalValue || null
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

async function handleRequest(event, entry) {
  const arkModel = readEnv(event, 'ARK_MODEL')
  const arkApiKey = readEnv(event, 'ARK_API_KEY')

  return new Response(
    JSON.stringify(
      {
        ok: true,
        message: 'Pages Functions smoke test is alive.',
        now: new Date().toISOString(),
        route: '/pages-smoke',
        entry,
        checks: {
          hasArkModel: Boolean(arkModel),
          hasArkApiKey: Boolean(arkApiKey),
        },
        values: {
          arkModel: arkModel || null,
          arkApiKeyMasked: maskValue(arkApiKey),
        },
      },
      null,
      2
    ),
    {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    }
  )
}

export function onRequest(context) {
  return handleRequest(context, 'onRequest')
}

addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event, 'fetch-event'))
})
