import './style.css'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed'
    platform: string
  }>
}

type PhotoItem = {
  id: string
  file: File
  label: string
  previewUrl: string
}

type RecognitionResult = {
  productionDate: string | null
  shelfLifeText: string | null
  expiryDate: string | null
  currentDate: string
  isExpired: boolean | null
  remainingDays: number | null
  reason: string | null
  recognizedText: string
}

type CloudRecognitionResponse = RecognitionResult & {
  ok: boolean
}

type DirectRecognitionImage = {
  fileName: string
  contentType: string
  dataUrl: string
}

type ShelfLifeUnit = 'day' | 'month' | 'year'

type ShelfLife = {
  value: number
  unit: ShelfLifeUnit
  rawText: string
}

const INSTALL_DISMISSED_KEY = 'food-expiry-install-dismissed'
const CLOUD_RECOGNITION_URL = 'https://1259665212-djiyi59a60.ap-shanghai.tencentscf.com'
const CLIENT_IMAGE_MAX_DIMENSION = 1080
const CLIENT_IMAGE_QUALITY = 0.62
const CLIENT_FAST_COUNT_HINT = 4

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('App root not found')
}

const state: {
  photos: PhotoItem[]
  isRecognizing: boolean
  progressText: string
  extractedResult: RecognitionResult | null
  finalResult: RecognitionResult | null
  editableProductionDate: string
  editableShelfLife: string
  editingProductionDate: boolean
  editingShelfLife: boolean
  adjustError: string | null
  deferredInstallPrompt: BeforeInstallPromptEvent | null
  isInstalled: boolean
  installGuideDismissed: boolean
} = {
  photos: [],
  isRecognizing: false,
  progressText: '',
  extractedResult: null,
  finalResult: null,
  editableProductionDate: '',
  editableShelfLife: '',
  editingProductionDate: false,
  editingShelfLife: false,
  adjustError: null,
  deferredInstallPrompt: null,
  isInstalled: isRunningStandalone(),
  installGuideDismissed: localStorage.getItem(INSTALL_DISMISSED_KEY) === '1',
}

setupInstallPrompt()
render()

function render() {
  app!.innerHTML = `
    <div class="page">
      ${renderInstallGuide()}
      <header class="hero-card">
        <p class="eyebrow">可放到手机桌面，像平时点 App 一样打开</p>
        <h1>食品保质期检测</h1>
        <p class="intro">
          把食品包装上能拍到的地方都拍下来。系统会帮你找出生产日期、保质期和到期日期，并告诉你是不是已经过期。
        </p>
        <p class="tips">
          温馨提示：照片上传后，需要等几秒钟系统帮你识别。网络慢时请耐心等待。放到手机桌面后，下次打开会更方便。
        </p>
      </header>

      <section class="card">
        <div class="section-head">
          <h2>拍照检查</h2>
          <span class="pill">已添加 ${state.photos.length} 张</span>
        </div>
        <div class="actions">
          <button id="takePhotoButton" class="primary-btn" ${state.isRecognizing ? 'disabled' : ''}>拍一张</button>
          <button id="pickPhotoButton" class="ghost-btn" ${state.isRecognizing ? 'disabled' : ''}>从相册添加</button>
          <button id="analyzeButton" class="secondary-btn" ${state.photos.length === 0 || state.isRecognizing ? 'disabled' : ''}>开始检查</button>
          <button id="clearButton" class="ghost-btn" ${state.photos.length === 0 || state.isRecognizing ? 'disabled' : ''}>清空重拍</button>
        </div>
        <div class="speed-tips">
          <strong>拍照建议：</strong>建议拍 2 到 4 张，重点拍清楚“保质期说明”和“喷码日期”。如果一次拍不清，可以多拍几张再检查。
        </div>
        ${
          state.photos.length > CLIENT_FAST_COUNT_HINT
            ? `<div class="status-box warning">现在图片有点多，建议控制在 4 张以内，这样会更快。</div>`
            : ''
        }
        <input id="takePhotoInput" class="hidden-input" type="file" accept="image/*" capture="environment" />
        <input id="albumInput" class="hidden-input" type="file" accept="image/*" multiple />
        ${
          state.isRecognizing
            ? `<div class="status-box loading">
                <div>${escapeHtml(state.progressText || '正在检查，请稍候...')}</div>
                <small>一般需要 8 到 15 秒，请不要关闭页面。</small>
              </div>`
            : ''
        }
        ${
          state.photos.length === 0
            ? `<div class="empty-box">还没有照片，请先拍包装正面、背面、侧面，以及日期附近的位置。</div>`
            : `<div class="photo-grid">
                ${state.photos
                  .map(
                    (photo) => `
                      <article class="photo-card">
                        <img src="${photo.previewUrl}" alt="${escapeHtml(photo.label)}" />
                        <div class="photo-meta">
                          <span>${escapeHtml(photo.label)}</span>
                          <button class="link-btn" data-remove-photo="${photo.id}" ${state.isRecognizing ? 'disabled' : ''}>删除</button>
                        </div>
                      </article>
                    `,
                  )
                  .join('')}
              </div>`
        }
      </section>

      <section class="card result-card">
        <div class="section-head">
          <h2>判断结果</h2>
          <span class="pill">当前日期 ${formatDateCn(todayString())}</span>
        </div>
        ${renderResultSection()}
      </section>
    </div>
  `

  bindEvents()
}

function bindEvents() {
  const takePhotoInput = document.querySelector<HTMLInputElement>('#takePhotoInput')
  const albumInput = document.querySelector<HTMLInputElement>('#albumInput')
  const takePhotoButton = document.querySelector<HTMLButtonElement>('#takePhotoButton')
  const pickPhotoButton = document.querySelector<HTMLButtonElement>('#pickPhotoButton')
  const analyzeButton = document.querySelector<HTMLButtonElement>('#analyzeButton')
  const clearButton = document.querySelector<HTMLButtonElement>('#clearButton')
  const productionDateYearSelect = document.querySelector<HTMLSelectElement>('#productionDateYear')
  const productionDateMonthSelect = document.querySelector<HTMLSelectElement>('#productionDateMonth')
  const productionDateDaySelect = document.querySelector<HTMLSelectElement>('#productionDateDay')
  const shelfLifeValueSelect = document.querySelector<HTMLSelectElement>('#shelfLifeValue')
  const shelfLifeUnitSelect = document.querySelector<HTMLSelectElement>('#shelfLifeUnit')
  const installAppButton = document.querySelector<HTMLButtonElement>('#installAppButton')
  const dismissInstallGuideButton = document.querySelector<HTMLButtonElement>(
    '#dismissInstallGuideButton',
  )
  const editProductionDateButton = document.querySelector<HTMLButtonElement>(
    '#editProductionDateButton',
  )
  const saveProductionDateButton = document.querySelector<HTMLButtonElement>(
    '#saveProductionDateButton',
  )
  const cancelProductionDateButton = document.querySelector<HTMLButtonElement>(
    '#cancelProductionDateButton',
  )
  const editShelfLifeButton = document.querySelector<HTMLButtonElement>('#editShelfLifeButton')
  const saveShelfLifeButton = document.querySelector<HTMLButtonElement>('#saveShelfLifeButton')
  const cancelShelfLifeButton = document.querySelector<HTMLButtonElement>(
    '#cancelShelfLifeButton',
  )

  takePhotoButton?.addEventListener('click', () => takePhotoInput?.click())
  pickPhotoButton?.addEventListener('click', () => albumInput?.click())

  takePhotoInput?.addEventListener('change', (event) => {
    const files = Array.from((event.target as HTMLInputElement).files ?? [])
    addPhotos(files)
    if (takePhotoInput) {
      takePhotoInput.value = ''
    }
  })

  albumInput?.addEventListener('change', (event) => {
    const files = Array.from((event.target as HTMLInputElement).files ?? [])
    addPhotos(files)
    if (albumInput) {
      albumInput.value = ''
    }
  })

  analyzeButton?.addEventListener('click', () => {
    void analyzePhotos()
  })

  clearButton?.addEventListener('click', () => clearPhotos())

  const syncProductionDatePicker = (rerenderAfterSync: boolean) => {
    if (!productionDateYearSelect || !productionDateMonthSelect || !productionDateDaySelect) {
      return
    }

    const year = Number(productionDateYearSelect.value)
    const month = Number(productionDateMonthSelect.value)
    const maxDay = getDaysInMonth(year, month)
    const day = Math.min(Number(productionDateDaySelect.value), maxDay)

    state.editableProductionDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

    if (rerenderAfterSync) {
      render()
    }
  }

  productionDateYearSelect?.addEventListener('change', () => syncProductionDatePicker(true))
  productionDateMonthSelect?.addEventListener('change', () => syncProductionDatePicker(true))
  productionDateDaySelect?.addEventListener('change', () => syncProductionDatePicker(false))
  const syncShelfLifePicker = (rerenderAfterSync: boolean) => {
    if (!shelfLifeValueSelect || !shelfLifeUnitSelect) {
      return
    }

    const unit = shelfLifeUnitSelect.value as ShelfLifeUnit
    const maxValue = getShelfLifeMaxValue(unit)
    const value = Math.min(Number(shelfLifeValueSelect.value), maxValue)
    const unitText = unit === 'day' ? '天' : unit === 'month' ? '个月' : '年'

    state.editableShelfLife = `${value}${unitText}`

    if (rerenderAfterSync) {
      render()
    }
  }

  shelfLifeValueSelect?.addEventListener('change', () => syncShelfLifePicker(false))
  shelfLifeUnitSelect?.addEventListener('change', () => syncShelfLifePicker(true))

  document.querySelectorAll<HTMLButtonElement>('[data-remove-photo]').forEach((button) => {
    button.addEventListener('click', () => {
      removePhoto(button.dataset.removePhoto ?? '')
    })
  })

  installAppButton?.addEventListener('click', () => {
    void installApp()
  })

  dismissInstallGuideButton?.addEventListener('click', () => {
    dismissInstallGuide()
  })

  editProductionDateButton?.addEventListener('click', () => {
    state.adjustError = null
    state.editingProductionDate = true
    render()
  })

  saveProductionDateButton?.addEventListener('click', () => {
    saveAdjustments('productionDate')
  })

  cancelProductionDateButton?.addEventListener('click', () => {
    cancelAdjustment('productionDate')
  })

  editShelfLifeButton?.addEventListener('click', () => {
    state.adjustError = null
    state.editingShelfLife = true
    render()
  })

  saveShelfLifeButton?.addEventListener('click', () => {
    saveAdjustments('shelfLife')
  })

  cancelShelfLifeButton?.addEventListener('click', () => {
    cancelAdjustment('shelfLife')
  })
}

function addPhotos(files: File[]) {
  if (files.length === 0) return

  const newPhotos = files.map<PhotoItem>((file, index) => ({
    id: crypto.randomUUID(),
    file,
    label: `包装第 ${state.photos.length + index + 1} 面`,
    previewUrl: URL.createObjectURL(file),
  }))

  state.photos = [...state.photos, ...newPhotos]
  state.extractedResult = null
  state.finalResult = null
  state.editableProductionDate = ''
  state.editableShelfLife = ''
  state.editingProductionDate = false
  state.editingShelfLife = false
  state.adjustError = null
  render()
}

function removePhoto(photoId: string) {
  const target = state.photos.find((photo) => photo.id === photoId)
  if (target) {
    URL.revokeObjectURL(target.previewUrl)
  }

  state.photos = state.photos
    .filter((photo) => photo.id !== photoId)
    .map((photo, index) => ({
      ...photo,
      label: `包装第 ${index + 1} 面`,
    }))

  state.extractedResult = null
  state.finalResult = null
  state.editableProductionDate = ''
  state.editableShelfLife = ''
  state.editingProductionDate = false
  state.editingShelfLife = false
  state.adjustError = null
  render()
}

function clearPhotos() {
  state.photos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl))
  state.photos = []
  state.extractedResult = null
  state.finalResult = null
  state.editableProductionDate = ''
  state.editableShelfLife = ''
  state.editingProductionDate = false
  state.editingShelfLife = false
  state.adjustError = null
  state.progressText = ''
  render()
}

async function analyzePhotos() {
  if (state.photos.length === 0) {
    return
  }

  state.isRecognizing = true
  state.progressText = '正在准备照片...'
  state.extractedResult = null
  state.finalResult = null
  render()

  try {
    const images: DirectRecognitionImage[] = []
    for (const [index, photo] of state.photos.entries()) {
      state.progressText = `正在处理第 ${index + 1} / ${state.photos.length} 张照片...`
      render()
      images.push(await buildDirectRecognitionImage(photo.file))
    }

    state.progressText =
      state.photos.length > CLIENT_FAST_COUNT_HINT
        ? '照片较多，处理会慢一些，请耐心等待...'
        : '正在帮你识别，请稍候...'
    render()

    const extracted = await invokeCloudRecognition(images)

    state.extractedResult = extracted
    state.finalResult = extracted.isExpired === null ? null : extracted
    state.editableProductionDate = extracted.productionDate ?? ''
    state.editableShelfLife = extracted.shelfLifeText ?? ''
    state.editingProductionDate = false
    state.editingShelfLife = false
    state.adjustError = null
  } catch (error) {
    const reason = error instanceof Error ? error.message : '识别时出现异常，请重新尝试。'
    state.extractedResult = {
      productionDate: null,
      shelfLifeText: null,
      expiryDate: null,
      currentDate: todayString(),
      isExpired: null,
      reason: `识别失败：${reason}`,
      remainingDays: null,
      recognizedText: '',
    }
    state.finalResult = null
    state.editableProductionDate = ''
    state.editableShelfLife = ''
    state.editingProductionDate = false
    state.editingShelfLife = false
    state.adjustError = null
  } finally {
    state.isRecognizing = false
    state.progressText = ''
    render()
  }
}

function buildFinalResult(
  productionDateInput: string,
  shelfLifeInput: string,
  recognizedText: string,
  currentDate: string,
): RecognitionResult {
  const productionDate = parseDateInput(productionDateInput)
  if (!productionDate) {
    return {
      productionDate: null,
      shelfLifeText: shelfLifeInput.trim() || null,
      expiryDate: null,
      currentDate,
      isExpired: null,
      remainingDays: null,
      reason: '生产日期格式不正确，请输入例如 2026-05-09。',
      recognizedText,
    }
  }

  const shelfLife = parseShelfLifeInput(shelfLifeInput)
  if (!shelfLife) {
    return {
      productionDate,
      shelfLifeText: shelfLifeInput.trim() || null,
      expiryDate: null,
      currentDate,
      isExpired: null,
      remainingDays: null,
      reason: '保质期格式不正确，请输入例如 30天、6个月、1年。',
      recognizedText,
    }
  }

  const expiryDate = addShelfLife(parseDateString(productionDate), shelfLife)
  const expiryDateString = formatDateString(expiryDate)
  const remainingDays = calcRemainingDays(currentDate, expiryDateString)
  const isExpired = remainingDays < 0

  return {
    productionDate,
    shelfLifeText: shelfLife.rawText,
    expiryDate: expiryDateString,
    currentDate,
    isExpired,
    remainingDays,
    reason: null,
    recognizedText,
  }
}

function parseShelfLifeInput(value: string): ShelfLife | null {
  const normalized = value.replace(/\s+/g, '').trim()
  const directMatch = normalized.match(/^(\d{1,3})(个?月|天|日|年)$/)
  if (directMatch) {
    return createShelfLife(directMatch[1], directMatch[2])
  }

  return findShelfLife(normalized)
}

function findShelfLife(text: string): ShelfLife | null {
  const labeledRegex =
    /(保质期|保存期|质保期|保期|保藏期|贮藏期|賞味期限|最佳食用期|建议尽快饮用)[:：]?[^\d]{0,8}(\d{1,3})\s*(个?月|天|日|年)/gi

  for (const match of text.matchAll(labeledRegex)) {
    const shelfLife = createShelfLife(match[2], match[3])
    if (shelfLife) {
      return shelfLife
    }
  }

  const plainRegex = /(\d{1,3})\s*(个?月|天|日|年)/g
  for (const match of text.matchAll(plainRegex)) {
    const start = Math.max(0, (match.index ?? 0) - 12)
    const context = text.slice(start, start + 24)
    if (/(保质期|保存期|质保期|保期|保藏期|贮藏期|常温保存|阴凉干燥处|开盖后|冷藏)/.test(context)) {
      return createShelfLife(match[1], match[2])
    }
  }

  return null
}

function createShelfLife(valueText: string, unitText: string): ShelfLife | null {
  const value = Number.parseInt(valueText, 10)
  if (Number.isNaN(value) || value <= 0) {
    return null
  }

  if (unitText === '天' || unitText === '日') {
    return { value, unit: 'day', rawText: `${value}${unitText}` }
  }

  if (unitText === '个月' || unitText === '月') {
    return { value, unit: 'month', rawText: `${value}${unitText}` }
  }

  if (unitText === '年') {
    return { value, unit: 'year', rawText: `${value}${unitText}` }
  }

  return null
}

function addShelfLife(date: Date, shelfLife: ShelfLife): Date {
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

function parseDateInput(value: string): string | null {
  const normalized = value
    .trim()
    .replaceAll('年', '-')
    .replaceAll('月', '-')
    .replaceAll('日', '')
    .replaceAll('/', '-')
    .replaceAll('.', '-')

  const compactMatch = normalized.match(/^(20\d{2})(\d{2})(\d{2})$/)
  if (compactMatch) {
    return parseDateInput(`${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`)
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

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function parseDateString(dateString: string): Date {
  const [year, month, day] = dateString.split('-').map((item) => Number.parseInt(item, 10))
  return new Date(year, month - 1, day)
}

function formatDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`
}

async function invokeCloudRecognition(images: DirectRecognitionImage[]): Promise<RecognitionResult> {
  const response = await fetch(CLOUD_RECOGNITION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      op: 'run',
      images,
    }),
  })

  const payload = (await response.json().catch(() => null)) as CloudRecognitionResponse | null
  if (!response.ok) {
    throw new Error(payload?.reason || `云端接口请求失败（${response.status}）`)
  }

  if (!payload) {
    throw new Error('云端接口没有返回有效数据。')
  }

  return {
    productionDate: payload.productionDate ?? null,
    shelfLifeText: payload.shelfLifeText ?? null,
    expiryDate: payload.expiryDate ?? null,
    currentDate: payload.currentDate ?? todayString(),
    isExpired: payload.isExpired ?? null,
    remainingDays: typeof payload.remainingDays === 'number' ? payload.remainingDays : null,
    reason: payload.reason ?? null,
    recognizedText: payload.recognizedText ?? '',
  }
}

async function buildDirectRecognitionImage(file: File): Promise<DirectRecognitionImage> {
  const compressed = await compressImageFile(file)
  return {
    fileName: file.name || `photo-${Date.now()}.jpg`,
    contentType: 'image/jpeg',
    dataUrl: compressed,
  }
}

async function compressImageFile(file: File): Promise<string> {
  const originalDataUrl = await readFileAsDataUrl(file)
  if (!file.type.startsWith('image/')) {
    return originalDataUrl
  }

  try {
    const image = await loadImage(originalDataUrl)
    const scale = Math.min(
      1,
      CLIENT_IMAGE_MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
    )
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')

    if (!context) {
      return originalDataUrl
    }

    context.drawImage(image, 0, 0, width, height)
    return await canvasToJpegDataUrl(canvas, CLIENT_IMAGE_QUALITY)
  } catch {
    return originalDataUrl
  }
}

function canvasToJpegDataUrl(canvas: HTMLCanvasElement, quality: number): Promise<string> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(canvas.toDataURL('image/jpeg', quality))
          return
        }

        const reader = new FileReader()
        reader.onload = () => {
          resolve(typeof reader.result === 'string' ? reader.result : canvas.toDataURL('image/jpeg', quality))
        }
        reader.onerror = () => resolve(canvas.toDataURL('image/jpeg', quality))
        reader.readAsDataURL(blob)
      },
      'image/jpeg',
      quality,
    )
  })
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }
      reject(new Error('读取图片失败，请重试。'))
    }
    reader.onerror = () => reject(new Error('读取图片失败，请重试。'))
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片解码失败，请重试。'))
    image.src = src
  })
}

function todayString(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`
}

function formatDateCn(dateString: string): string {
  const date = parseDateString(dateString)
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

function calcRemainingDays(currentDateString: string, expiryDateString: string): number {
  const current = parseDateString(currentDateString)
  const expiry = parseDateString(expiryDateString)
  return Math.floor((expiry.getTime() - current.getTime()) / 86400000)
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function getShelfLifeMaxValue(unit: ShelfLifeUnit): number {
  if (unit === 'day') return 365
  if (unit === 'month') return 36
  return 10
}

function renderSelectOptions(
  values: number[],
  selectedValue: number,
  formatter: (value: number) => string,
): string {
  return values
    .map(
      (value) =>
        `<option value="${value}" ${value === selectedValue ? 'selected' : ''}>${formatter(value)}</option>`,
    )
    .join('')
}

function renderProductionDatePicker(value: string): string {
  const normalizedValue = parseDateInput(value) ?? todayString()
  const [yearText, monthText, dayText] = normalizedValue.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const currentYear = new Date().getFullYear()
  const startYear = Math.max(2000, currentYear - 20)
  const yearOptions = Array.from(
    { length: currentYear - startYear + 1 },
    (_, index) => currentYear - index,
  )
  const monthOptions = Array.from({ length: 12 }, (_, index) => index + 1)
  const dayOptions = Array.from({ length: getDaysInMonth(year, month) }, (_, index) => index + 1)

  return `
    <div class="date-picker-group production-date-picker-group">
      <label class="date-picker-field date-picker-field-year" for="productionDateYear">
        <span>年份</span>
        <select id="productionDateYear">
          ${renderSelectOptions(yearOptions, year, (item) => `${item}`)}
        </select>
      </label>
      <label class="date-picker-field" for="productionDateMonth">
        <span>月份</span>
        <select id="productionDateMonth">
          ${renderSelectOptions(monthOptions, month, (item) => `${item}`)}
        </select>
      </label>
      <label class="date-picker-field" for="productionDateDay">
        <span>日期</span>
        <select id="productionDateDay">
          ${renderSelectOptions(dayOptions, day, (item) => `${item}`)}
        </select>
      </label>
    </div>
  `
}

function renderShelfLifePicker(value: string): string {
  const shelfLife = parseShelfLifeInput(value) ?? { value: 12, unit: 'month', rawText: '12个月' }
  const valueOptions = Array.from(
    { length: getShelfLifeMaxValue(shelfLife.unit) },
    (_, index) => index + 1,
  )
  const unitOptions: Array<{ value: ShelfLifeUnit; label: string }> = [
    { value: 'day', label: '天' },
    { value: 'month', label: '月' },
    { value: 'year', label: '年' },
  ]

  return `
    <div class="date-picker-group shelf-life-picker-group">
      <label class="date-picker-field" for="shelfLifeValue">
        <span>数值</span>
        <select id="shelfLifeValue">
          ${renderSelectOptions(valueOptions, shelfLife.value, (item) => `${item}`)}
        </select>
      </label>
      <label class="date-picker-field" for="shelfLifeUnit">
        <span>单位</span>
        <select id="shelfLifeUnit">
          ${unitOptions
            .map(
              (option) =>
                `<option value="${option.value}" ${option.value === shelfLife.unit ? 'selected' : ''}>${option.label}</option>`,
            )
            .join('')}
        </select>
      </label>
    </div>
  `
}

function renderResultSection(): string {
  if (state.isRecognizing) {
    return `<div class="status-box loading">${escapeHtml(state.progressText || '正在识别，请稍候...')}</div>`
  }

  if (!state.extractedResult) {
    return `<div class="empty-box">拍照完成后，点“开始检查”，系统就会帮你找出生产日期和保质期。</div>`
  }

  if (!state.finalResult) {
    return `
      <div class="status-box warning">错误：${escapeHtml(state.extractedResult.reason ?? '无法提取信息。')}</div>
      ${renderRecognizedText(state.extractedResult.recognizedText)}
    `
  }

  return `
    <div class="result-grid">
      ${renderAdjustableField('productionDate')}
      ${renderAdjustableField('shelfLife')}
      <div><span>到期日期</span><strong>${formatDateCn(state.finalResult.expiryDate ?? state.finalResult.currentDate)}</strong></div>
      <div><span>还剩天数</span><strong class="${state.finalResult.remainingDays !== null && state.finalResult.remainingDays < 0 ? 'expired' : 'fresh'}">${renderRemainingDaysText(state.finalResult.remainingDays)}</strong></div>
      <div><span>当前日期</span><strong>${formatDateCn(state.finalResult.currentDate)}</strong></div>
      <div><span>是否过期</span><strong class="${state.finalResult.isExpired ? 'expired' : 'fresh'}">${renderExpiredText(state.finalResult.isExpired)}</strong></div>
    </div>
    ${
      state.adjustError
        ? `<div class="status-box warning">调整失败：${escapeHtml(state.adjustError)}</div>`
        : ''
    }
    ${renderRecognizedText(state.finalResult.recognizedText)}
  `
}

function renderAdjustableField(field: 'productionDate' | 'shelfLife'): string {
  const isProductionDate = field === 'productionDate'
  const isEditing = isProductionDate ? state.editingProductionDate : state.editingShelfLife
  const editButtonId = isProductionDate ? 'editProductionDateButton' : 'editShelfLifeButton'
  const saveButtonId = isProductionDate ? 'saveProductionDateButton' : 'saveShelfLifeButton'
  const cancelButtonId = isProductionDate ? 'cancelProductionDateButton' : 'cancelShelfLifeButton'
  const title = isProductionDate ? '生产日期' : '保质期'
  const rawValue = isProductionDate ? state.editableProductionDate : state.editableShelfLife
  const displayValue = isProductionDate
    ? rawValue
      ? formatDateCn(rawValue)
      : '未识别到'
    : rawValue || '未识别到'

  if (!isEditing) {
    return `
      <div class="adjustable-card">
        <span>${title}</span>
        <strong>${escapeHtml(displayValue)}</strong>
        <button id="${editButtonId}" class="field-btn">调整</button>
      </div>
    `
  }

  return `
    <div class="adjustable-card editing">
      <span>${title}</span>
      ${
        isProductionDate
          ? `${renderProductionDatePicker(rawValue)}<small class="input-hint">请按顺序选择年、月、日。</small>`
          : `${renderShelfLifePicker(rawValue)}<small class="input-hint">请先选数字，再选单位。</small>`
      }
      <div class="inline-actions">
        <button id="${saveButtonId}" class="field-btn primary-inline-btn">保存</button>
        <button id="${cancelButtonId}" class="field-btn">取消</button>
      </div>
    </div>
  `
}

function renderRecognizedText(recognizedText: string): string {
  if (!recognizedText.trim()) {
    return ''
  }

  return `
    <details class="details-box">
      <summary>查看识别到的原始文字</summary>
      <pre>${escapeHtml(recognizedText)}</pre>
    </details>
  `
}

function renderExpiredText(value: boolean | null): string {
  if (value === true) return '已过期'
  if (value === false) return '未过期'
  return '暂时无法判断'
}

function renderRemainingDaysText(value: number | null): string {
  if (value === null) return '暂时无法判断'
  if (value > 0) return `还剩 ${value} 天`
  if (value === 0) return '今天到期'
  return `已超过 ${Math.abs(value)} 天`
}

function saveAdjustments(field: 'productionDate' | 'shelfLife') {
  if (!state.extractedResult) {
    return
  }

  const recalculated = buildFinalResult(
    state.editableProductionDate,
    state.editableShelfLife,
    state.extractedResult.recognizedText,
    state.extractedResult.currentDate,
  )

  if (recalculated.isExpired === null) {
    state.adjustError = recalculated.reason
    render()
    return
  }

  state.finalResult = recalculated
  state.adjustError = null
  if (field === 'productionDate') {
    state.editingProductionDate = false
  } else {
    state.editingShelfLife = false
  }
  render()
}

function cancelAdjustment(field: 'productionDate' | 'shelfLife') {
  if (!state.finalResult) {
    return
  }

  if (field === 'productionDate') {
    state.editableProductionDate = state.finalResult.productionDate ?? ''
    state.editingProductionDate = false
  } else {
    state.editableShelfLife = state.finalResult.shelfLifeText ?? ''
    state.editingShelfLife = false
  }
  state.adjustError = null
  render()
}

function renderInstallGuide(): string {
  if (state.isInstalled || state.installGuideDismissed) {
    return ''
  }

  if (state.deferredInstallPrompt) {
    return `
      <section class="install-guide">
        <div>
          <p class="install-guide-title">建议放到手机桌面</p>
          <p class="install-guide-text">放到桌面后，下次只要点一下图标，就能直接打开，不用再去浏览器里找。</p>
        </div>
        <div class="install-guide-actions">
          <button id="installAppButton" class="primary-btn">放到桌面</button>
          <button id="dismissInstallGuideButton" class="ghost-btn">稍后再说</button>
        </div>
      </section>
    `
  }

  if (shouldShowIosGuide()) {
    return `
      <section class="install-guide">
        <div>
          <p class="install-guide-title">可放到手机桌面</p>
          <p class="install-guide-text">iPhone 请先点浏览器下面的“分享”，再点“添加到主屏幕”，以后就能直接从桌面打开。</p>
        </div>
        <div class="install-guide-actions">
          <button id="dismissInstallGuideButton" class="ghost-btn">我知道了</button>
        </div>
      </section>
    `
  }

  return ''
}

function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    state.deferredInstallPrompt = event as BeforeInstallPromptEvent
    state.installGuideDismissed = false
    localStorage.removeItem(INSTALL_DISMISSED_KEY)
    render()
  })

  window.addEventListener('appinstalled', () => {
    state.isInstalled = true
    state.deferredInstallPrompt = null
    render()
  })
}

async function installApp() {
  if (!state.deferredInstallPrompt) {
    return
  }

  const promptEvent = state.deferredInstallPrompt
  await promptEvent.prompt()
  const choice = await promptEvent.userChoice
  state.deferredInstallPrompt = null

  if (choice.outcome !== 'accepted') {
    state.installGuideDismissed = true
    localStorage.setItem(INSTALL_DISMISSED_KEY, '1')
  }

  render()
}

function dismissInstallGuide() {
  state.installGuideDismissed = true
  localStorage.setItem(INSTALL_DISMISSED_KEY, '1')
  render()
}

function shouldShowIosGuide(): boolean {
  return isIosDevice() && !state.isInstalled
}

function isIosDevice(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent)
}

function isRunningStandalone(): boolean {
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean }
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    navigatorWithStandalone.standalone === true
  )
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
