function corsHeaders(extraHeaders) {
  return Object.assign(
    {
      'content-type': 'application/json; charset=UTF-8',
      'cache-control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    extraHeaders || {}
  )
}

export async function onRequest(request) {
  try {
    if (request.method === 'OPTIONS') {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: corsHeaders(),
      })
    }

    if (request.method === 'GET') {
      return new Response(
        JSON.stringify({
          ok: true,
          message: 'pages recognize function is alive',
          method: 'GET',
        }),
        {
          status: 200,
          headers: corsHeaders(),
        }
      )
    }

    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({
          ok: false,
          reason: '只支持 POST 请求。',
        }),
        {
          status: 405,
          headers: corsHeaders(),
        }
      )
    }

    const body = await parseRequestBody(request)
    if (body.op !== 'run') {
      return new Response(
        JSON.stringify({
          ok: false,
          reason: '不支持的请求。请使用 op=run。',
        }),
        {
          status: 400,
          headers: corsHeaders(),
        }
      )
    }

    if (!process.env.ARK_API_KEY) {
      return new Response(
        JSON.stringify({
          ok: false,
          reason: 'Pages Functions 缺少 ARK_API_KEY 环境变量。',
        }),
        {
          status: 500,
          headers: corsHeaders(),
        }
      )
    }

    const images = normalizeIncomingImages(body.images)
    if (images.length === 0) {
      return new Response(
        JSON.stringify({
          ok: false,
          reason: '请求中缺少可识别的图片数据。',
        }),
        {
          status: 400,
          headers: corsHeaders(),
        }
      )
    }

    if (images.length > 6) {
      return new Response(
        JSON.stringify({
          ok: false,
          reason: '单次最多识别 6 张图片。',
        }),
        {
          status: 400,
          headers: corsHeaders(),
        }
      )
    }

    const currentDate = todayString()
    const arkTimeoutMs = getPositiveInteger(process.env.ARK_TIMEOUT_MS, 18000)
    const arkMaxTokens = getPositiveInteger(process.env.ARK_MAX_TOKENS, 320)
    const arkImageDetail = getArkImageDetail(process.env.ARK_IMAGE_DETAIL)
    const arkPrimaryReasoningEffort = getReasoningEffort(
      process.env.ARK_REASONING_EFFORT,
      'low'
    )
    const arkRetryReasoningEffort = getReasoningEffort(
      process.env.ARK_REASONING_EFFORT_RETRY,
      'medium'
    )
    const arkRetryImageDetail = getArkImageDetail(process.env.ARK_IMAGE_DETAIL_RETRY || 'high')
    const arkRetryMaxTokens = getPositiveInteger(
      process.env.ARK_MAX_TOKENS_RETRY,
      Math.max(arkMaxTokens, 420)
    )
    const modelId = process.env.ARK_MODEL || 'doubao-seed-2-0-mini-260428'

    const firstTry = await runArkTry({
      apiKey: process.env.ARK_API_KEY,
      baseUrl: process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3',
      model: modelId,
      currentDate,
      images,
      timeoutMs: arkTimeoutMs,
      maxTokens: arkMaxTokens,
      imageDetail: arkImageDetail,
      reasoningEffort: arkPrimaryReasoningEffort,
    })

    let result = firstTry.result
    if (firstTry.error || !result || result.isExpired === null) {
      const secondTry = await runArkTry({
        apiKey: process.env.ARK_API_KEY,
        baseUrl: process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3',
        model: modelId,
        currentDate,
        images,
        timeoutMs: arkTimeoutMs,
        maxTokens: arkRetryMaxTokens,
        imageDetail: arkRetryImageDetail,
        reasoningEffort: arkRetryReasoningEffort,
      })

      if (secondTry.result) {
        result = secondTry.result
      } else if (firstTry.result) {
        result = firstTry.result
        result.reason =
          (result.reason || '识别失败') +
          '。已自动重试一轮仍未识别成功，请补拍更清晰的日期和保质期区域。'
      } else {
        throw secondTry.error || firstTry.error || new Error('识别失败')
      }
    }

    return new Response(
      JSON.stringify({
        ok: result.isExpired !== null,
        productionDate: result.productionDate,
        shelfLifeText: result.shelfLifeText,
        expiryDate: result.expiryDate,
        currentDate: result.currentDate,
        isExpired: result.isExpired,
        remainingDays: result.remainingDays,
        reason: result.reason,
        recognizedText: result.recognizedText,
      }),
      {
        status: 200,
        headers: corsHeaders(),
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({
        ok: false,
        productionDate: null,
        shelfLifeText: null,
        expiryDate: null,
        currentDate: todayString(),
        isExpired: null,
        remainingDays: null,
        reason: '云端识别失败：' + getErrorMessage(error),
        recognizedText: '',
      }),
      {
        status: 500,
        headers: corsHeaders(),
      }
    )
  }
}

async function parseRequestBody(request) {
  const contentType = String(request.headers.get('content-type') || '').toLowerCase()

  if (contentType.includes('application/json')) {
    return (await request.json().catch(() => null)) || {}
  }

  const rawText = await request.text()
  if (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('text/plain')
  ) {
    const params = new URLSearchParams(rawText)
    const result = {}
    for (const [key, value] of params.entries()) {
      result[key] = value
    }
    return result
  }

  return {}
}

async function runArkTry(options) {
  try {
    const arkResult = await callArkRecognition(options)
    const result = normalizeArkRecognition(arkResult, options.currentDate)
    return { result, error: null }
  } catch (error) {
    return { result: null, error }
  }
}

async function callArkRecognition(options) {
  const prompt =
    '综合多张食品包装图片，提取生产日期和保质期，并根据当前日期 ' +
    options.currentDate +
    ' 判断是否过期。' +
    '如一张图有保质期、另一张图有喷码日期，请合并判断。' +
    'recognizedText 只保留与日期、保质期有关的关键原文，尽量简短，最多保留几行。' +
    '只输出 JSON，格式固定为：' +
    '{"productionDate":"","shelfLifeText":"","expiryDate":"","isExpired":null,"reason":"","recognizedText":""}' +
    'productionDate 和 expiryDate 使用 YYYY-MM-DD；无法确定填空字符串；isExpired 无法判断填 null。'

  const content = [
    {
      type: 'text',
      text: prompt,
    },
  ]

  options.images.forEach((image) => {
    content.push({
      type: 'image_url',
      image_url: {
        url: image.dataUrl,
        detail: options.imageDetail,
      },
    })
  })

  const payload = {
    model: options.model,
    messages: [
      {
        role: 'user',
        content,
      },
    ],
    temperature: 0,
    max_tokens: options.maxTokens,
  }

  if (options.reasoningEffort) {
    payload.reasoning = {
      effort: options.reasoningEffort,
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs)

  try {
    const response = await fetch(options.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + options.apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    const raw = await response.text()
    const parsed = parseJsonSafely(raw)
    if (!response.ok) {
      throw new Error(
        (parsed && parsed.error && parsed.error.message) || raw || '方舟识别请求失败。'
      )
    }

    if (!parsed) {
      throw new Error('方舟识别返回了无效响应，请稍后重试。')
    }

    if (parsed.error) {
      throw new Error(parsed.error.message || '方舟识别请求失败。')
    }

    const rawText = extractMessageText(parsed)
    if (!rawText.trim()) {
      throw new Error('方舟识别没有返回结果。')
    }

    return {
      rawText,
      structured: extractStructuredJson(rawText),
    }
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error('方舟识别请求超时，请稍后重试。')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function parseJsonSafely(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function getPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed
  }
  return fallback
}

function sanitizeOcrContent(content) {
  const text = Array.isArray(content)
    ? content
        .map((item) => {
          if (typeof item === 'string') return item
          if (item && typeof item.text === 'string') return item.text
          return ''
        })
        .join('\n')
    : String(content || '')

  return text
    .replace(/<\|det\|>[\s\S]*?<\|\/det\|>/g, ' ')
    .replace(/<\|ref\|>/g, '')
    .replace(/<\|\/ref\|>/g, '')
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-z]*\n?/gi, '').replace(/```/g, ''))
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizeIncomingImages(rawImages) {
  const images = Array.isArray(rawImages) ? rawImages : []
  return images
    .map((image) => ({
      fileName: coerceString(image && image.fileName),
      contentType: coerceString(image && image.contentType) || 'image/jpeg',
      dataUrl: coerceString(image && image.dataUrl),
    }))
    .filter((image) => /^data:image\/[a-z0-9.+-]+;base64,/i.test(image.dataUrl))
}

function extractMessageText(payload) {
  const choice =
    payload && payload.choices && payload.choices[0] && payload.choices[0].message
      ? payload.choices[0].message
      : null

  const content = choice ? choice.content : ''
  return sanitizeOcrContent(content)
}

function extractStructuredJson(text) {
  const raw = String(text || '').trim()
  if (!raw) {
    return null
  }

  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  const direct = parseJsonSafely(cleaned)
  if (direct && typeof direct === 'object') {
    return direct
  }

  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return parseJsonSafely(cleaned.slice(firstBrace, lastBrace + 1))
  }

  return null
}

function normalizeArkRecognition(arkResult, currentDate) {
  const structured = arkResult && arkResult.structured ? arkResult.structured : {}
  const recognizedText = coerceString(
    structured.recognizedText ||
      structured.recognized_text ||
      structured.ocrText ||
      structured.ocr_text
  )
  const modelReason = coerceString(structured.reason)
  const directProductionDate = parseDateInput(
    structured.productionDate || structured.production_date || ''
  )
  const directShelfLifeText = normalizeShelfLifeText(
    structured.shelfLifeText || structured.shelf_life_text || ''
  )
  const directExpiryDate = parseDateInput(structured.expiryDate || structured.expiry_date || '')
  const directIsExpired = parseBooleanLike(structured.isExpired)

  if (directProductionDate && directShelfLifeText) {
    const built = buildFinalResult(
      directProductionDate,
      directShelfLifeText,
      recognizedText,
      currentDate
    )

    if (directExpiryDate) {
      built.expiryDate = directExpiryDate
      built.remainingDays = calcRemainingDays(currentDate, directExpiryDate)
    }
    if (directIsExpired !== null) {
      built.isExpired = directIsExpired
    }
    if (modelReason) {
      built.reason = modelReason
    }

    return built
  }

  const fallbackText = recognizedText || String((arkResult && arkResult.rawText) || '')
  if (fallbackText.trim()) {
    const fallback = extractRecognition(fallbackText)

    if (!fallback.productionDate && directProductionDate) {
      fallback.productionDate = directProductionDate
    }
    if (!fallback.shelfLifeText && directShelfLifeText) {
      fallback.shelfLifeText = directShelfLifeText
    }
    if (!fallback.expiryDate && directExpiryDate) {
      fallback.expiryDate = directExpiryDate
      fallback.remainingDays = calcRemainingDays(currentDate, directExpiryDate)
    }
    if (fallback.isExpired === null && directIsExpired !== null) {
      fallback.isExpired = directIsExpired
    }
    if (modelReason) {
      fallback.reason = modelReason
    }

    return fallback
  }

  return {
    productionDate: directProductionDate || null,
    shelfLifeText: directShelfLifeText || null,
    expiryDate: directExpiryDate || null,
    currentDate,
    isExpired: directIsExpired,
    remainingDays: directExpiryDate ? calcRemainingDays(currentDate, directExpiryDate) : null,
    reason: modelReason || '模型没有返回足够的信息，请重新拍摄更清晰的照片。',
    recognizedText: '',
  }
}

function coerceString(value) {
  if (typeof value === 'string') {
    return value.trim()
  }
  return ''
}

function normalizeShelfLifeText(value) {
  const shelfLife = parseShelfLifeInput(value)
  return shelfLife ? shelfLife.rawText : null
}

function parseBooleanLike(value) {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
    if (normalized === 'null' || normalized === '') return null
  }

  return null
}

function getArkImageDetail(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'high' || normalized === 'low' || normalized === 'auto') {
    return normalized
  }
  return 'low'
}

function getReasoningEffort(value, fallback) {
  const normalized = String(value || '').trim().toLowerCase()
  if (
    normalized === 'minimal' ||
    normalized === 'low' ||
    normalized === 'medium' ||
    normalized === 'high'
  ) {
    return normalized
  }
  return fallback
}

function extractRecognition(recognizedText) {
  const currentDate = todayString()

  if (!recognizedText.trim()) {
    return {
      productionDate: null,
      shelfLifeText: null,
      expiryDate: null,
      currentDate,
      isExpired: null,
      remainingDays: null,
      reason: '没有识别到任何文字，可能是图片模糊、反光或角度不合适，请重新拍摄。',
      recognizedText: '',
    }
  }

  const normalized = normalizeText(recognizedText)
  const productionDate = findProductionDate(normalized)
  const shelfLife = findShelfLife(normalized)

  if (!productionDate && !shelfLife) {
    return {
      productionDate: null,
      shelfLifeText: null,
      expiryDate: null,
      currentDate,
      isExpired: null,
      remainingDays: null,
      reason: '无法提取生产日期和保质期，可能因为照片不清晰，或者照片中没有相关信息。',
      recognizedText,
    }
  }

  if (!productionDate) {
    return {
      productionDate: null,
      shelfLifeText: shelfLife ? shelfLife.rawText : null,
      expiryDate: null,
      currentDate,
      isExpired: null,
      remainingDays: null,
      reason: '无法提取完整信息，可能因为照片不清晰，或者照片中没有生产日期信息。',
      recognizedText,
    }
  }

  if (!shelfLife) {
    return {
      productionDate,
      shelfLifeText: null,
      expiryDate: null,
      currentDate,
      isExpired: null,
      remainingDays: null,
      reason: '无法提取完整信息，可能因为照片不清晰，或者照片中没有保质期信息。',
      recognizedText,
    }
  }

  return buildFinalResult(productionDate, shelfLife.rawText, recognizedText, currentDate)
}

function buildFinalResult(productionDateInput, shelfLifeInput, recognizedText, currentDate) {
  const productionDate = parseDateInput(productionDateInput)
  if (!productionDate) {
    return {
      productionDate: null,
      shelfLifeText: shelfLifeInput ? shelfLifeInput.trim() : null,
      expiryDate: null,
      currentDate,
      isExpired: null,
      remainingDays: null,
      reason: '生产日期格式不正确。',
      recognizedText,
    }
  }

  const shelfLife = parseShelfLifeInput(shelfLifeInput)
  if (!shelfLife) {
    return {
      productionDate,
      shelfLifeText: shelfLifeInput ? shelfLifeInput.trim() : null,
      expiryDate: null,
      currentDate,
      isExpired: null,
      remainingDays: null,
      reason: '保质期格式不正确。',
      recognizedText,
    }
  }

  const expiryDate = addShelfLife(parseDateString(productionDate), shelfLife)
  const expiryDateString = formatDateString(expiryDate)
  const remainingDays = calcRemainingDays(currentDate, expiryDateString)

  return {
    productionDate,
    shelfLifeText: shelfLife.rawText,
    expiryDate: expiryDateString,
    currentDate,
    isExpired: remainingDays < 0,
    remainingDays,
    reason: null,
    recognizedText,
  }
}

function calcRemainingDays(currentDateString, expiryDateString) {
  if (!currentDateString || !expiryDateString) {
    return null
  }
  const current = parseDateString(currentDateString)
  const expiry = parseDateString(expiryDateString)
  return Math.floor((expiry.getTime() - current.getTime()) / 86400000)
}

function parseShelfLifeInput(value) {
  const normalized = String(value || '').replace(/\s+/g, '').trim()
  const directMatch = normalized.match(/^(\d{1,3})(个?月|天|日|年)$/)
  if (directMatch) {
    return createShelfLife(directMatch[1], directMatch[2])
  }

  return findShelfLife(normalized)
}

function findProductionDate(text) {
  const labeledRegex =
    /(生产日期|制造日期|出厂日期|生產日期|製造日期|出廠日期|生产|制造|出厂|喷码|喷印|瓶肩)[:：]?[^\d]{0,6}(20\d{2}(?:[-./]\d{1,2}[-./]\d{1,2}|\d{2}\d{2}))/gi

  let match
  while ((match = labeledRegex.exec(text)) !== null) {
    const parsed = parseDateInput(match[2])
    if (parsed) {
      return parsed
    }
  }

  const dateRegex = /(20\d{2})[-./](\d{1,2})[-./](\d{1,2})/g
  const compactDateRegex = /20\d{2}[01]\d[0-3]\d/g
  const candidates = []

  while ((match = dateRegex.exec(text)) !== null) {
    const parsed = parseDateInput(match[1] + '-' + match[2] + '-' + match[3])
    if (parsed) {
      candidates.push(parsed)
    }
  }

  while ((match = compactDateRegex.exec(text)) !== null) {
    const parsed = parseDateInput(match[0])
    if (parsed) {
      candidates.push(parsed)
    }
  }

  if (candidates.length === 0) {
    return null
  }

  const today = todayString()
  const nonFuture = candidates.filter((item) => item <= today)
  const deduped = Array.from(new Set(nonFuture.length > 0 ? nonFuture : candidates)).sort()
  return deduped[0] || null
}

function findShelfLife(text) {
  const labeledRegex =
    /(保质期|保存期|质保期|保期|保藏期|贮藏期|賞味期限|最佳食用期|建议尽快饮用)[:：]?[^\d]{0,8}(\d{1,3})\s*(个?月|天|日|年)/gi

  let match
  while ((match = labeledRegex.exec(text)) !== null) {
    const shelfLife = createShelfLife(match[2], match[3])
    if (shelfLife) {
      return shelfLife
    }
  }

  const plainRegex = /(\d{1,3})\s*(个?月|天|日|年)/g
  while ((match = plainRegex.exec(text)) !== null) {
    const start = Math.max(0, (match.index || 0) - 12)
    const context = text.slice(start, start + 24)
    if (/(保质期|保存期|质保期|保期|保藏期|贮藏期|常温保存|阴凉干燥处|开盖后|冷藏)/.test(context)) {
      return createShelfLife(match[1], match[2])
    }
  }

  return null
}

function createShelfLife(valueText, unitText) {
  const value = Number.parseInt(valueText, 10)
  if (Number.isNaN(value) || value <= 0) {
    return null
  }

  if (unitText === '天' || unitText === '日') {
    return { value, unit: 'day', rawText: value + unitText }
  }

  if (unitText === '个月' || unitText === '月') {
    return { value, unit: 'month', rawText: value + unitText }
  }

  if (unitText === '年') {
    return { value, unit: 'year', rawText: value + unitText }
  }

  return null
}

function addShelfLife(date, shelfLife) {
  const result = new Date(date.getTime())

  if (shelfLife.unit === 'day') {
    result.setDate(result.getDate() + shelfLife.value)
  } else if (shelfLife.unit === 'month') {
    result.setMonth(result.getMonth() + shelfLife.value)
  } else {
    result.setFullYear(result.getFullYear() + shelfLife.value)
  }

  return result
}

function parseDateInput(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/年/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
    .replace(/\//g, '-')
    .replace(/\./g, '-')

  const compactMatch = normalized.match(/^(20\d{2})(\d{2})(\d{2})$/)
  if (compactMatch) {
    return parseDateInput(compactMatch[1] + '-' + compactMatch[2] + '-' + compactMatch[3])
  }

  const match = normalized.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})$/)
  if (!match) {
    return null
  }

  const year = Number.parseInt(match[1], 10)
  const month = Number.parseInt(match[2], 10)
  const day = Number.parseInt(match[3], 10)
  const date = new Date(year, month - 1, day)

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null
  }

  return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0')
}

function parseDateString(dateString) {
  const parts = dateString.split('-').map((item) => Number.parseInt(item, 10))
  return new Date(parts[0], parts[1] - 1, parts[2])
}

function formatDateString(date) {
  return (
    date.getFullYear() +
    '-' +
    String(date.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(date.getDate()).padStart(2, '0')
  )
}

function todayString() {
  const now = new Date()
  return (
    now.getFullYear() +
    '-' +
    String(now.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(now.getDate()).padStart(2, '0')
  )
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\s+/g, '')
    .replace(/：/g, ':')
    .replace(/O/g, '0')
    .replace(/o/g, '0')
    .replace(/B/g, '8')
    .replace(/I/g, '1')
    .replace(/l/g, '1')
}

function getErrorMessage(error) {
  return error && error.message ? error.message : '未知错误'
}
