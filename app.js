let currentOwner = CONFIG.owner
let currentRepo  = CONFIG.repo
let navStack     = []   // [{name, path}]

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('repo-input').value          = `${CONFIG.owner}/${CONFIG.repo}`
  document.getElementById('path-input').value          = CONFIG.path
  document.getElementById('site-title').textContent    = CONFIG.siteTitle
  document.getElementById('site-subtitle').textContent = CONFIG.siteSubtitle
  document.title = CONFIG.siteTitle

  if (CONFIG.owner !== 'OWNER') loadPDFs()
})

// ── ロード ────────────────────────────────────────────────────────────────────

async function loadPDFs() {
  const repoVal = document.getElementById('repo-input').value.trim()
  const pathVal = document.getElementById('path-input').value.trim()

  if (!repoVal.includes('/')) {
    showError('リポジトリは "owner/repo" の形式で入力してください。')
    return
  }

  const [owner, repo] = repoVal.split('/')
  currentOwner = owner
  currentRepo  = repo

  navStack = [{ name: 'ホーム', path: pathVal }]
  renderBreadcrumb()
  await fetchContents(pathVal)
}

async function fetchContents(path) {
  const grid    = document.getElementById('pdf-grid')
  const loading = document.getElementById('loading')
  const errorEl = document.getElementById('error')

  grid.innerHTML = ''
  errorEl.classList.add('hidden')
  loading.classList.remove('hidden')

  const apiUrl = `https://api.github.com/repos/${currentOwner}/${currentRepo}/contents/${path}`

  try {
    const res = await fetch(apiUrl)
    if (!res.ok) {
      const msg = res.status === 404
        ? 'リポジトリまたはパスが見つかりません。'
        : `GitHub API エラー: ${res.status}`
      throw new Error(msg)
    }

    const items = await res.json()
    if (!Array.isArray(items)) throw new Error('予期しないレスポンスです。')

    const dirs = items.filter(f => f.type === 'dir')
    const pdfs = items.filter(f => f.type === 'file' && f.name.toLowerCase().endsWith('.pdf'))

    loading.classList.add('hidden')

    if (dirs.length === 0 && pdfs.length === 0) {
      updateItemCount(0)
      showError('PDFファイルもフォルダも見つかりませんでした。')
      return
    }

    updateItemCount(dirs.length + pdfs.length)
    dirs.forEach((dir, i) => grid.appendChild(buildFolderCard(dir, i)))
    pdfs.forEach((file, i) => grid.appendChild(buildPdfCard(file, dirs.length + i)))

  } catch (err) {
    loading.classList.add('hidden')
    showError(err.message)
  }
}

// ── ナビゲーション ────────────────────────────────────────────────────────────

function renderBreadcrumb() {
  const bc = document.getElementById('breadcrumb')
  if (!bc) return

  if (navStack.length <= 1) {
    bc.innerHTML = ''
    bc.style.display = 'none'
    return
  }

  bc.style.display = 'flex'
  bc.innerHTML = navStack.map((item, i) => {
    const label = escapeHtml(item.name || 'ホーム')
    if (i === navStack.length - 1) {
      return `<span class="bc-current">${label}</span>`
    }
    return `<button class="bc-link" onclick="navTo(${i})">${label}</button>`
  }).join('<span class="bc-sep">›</span>')
}

function navTo(index) {
  navStack = navStack.slice(0, index + 1)
  renderBreadcrumb()
  fetchContents(navStack[navStack.length - 1].path)
}

function openFolder(name, path) {
  navStack.push({ name, path })
  renderBreadcrumb()
  fetchContents(path)
}

// ── カード構築 ────────────────────────────────────────────────────────────────

function buildFolderCard(dir, index) {
  const card = document.createElement('article')
  card.className = 'pdf-card folder-card'
  card.style.animationDelay = `${index * 60}ms`
  card.addEventListener('click', () => openFolder(dir.name, dir.path))

  card.innerHTML = `
    <span class="print-no" aria-hidden="true">其の${kanjiNumber(index + 1)}</span>
    <div class="card-body">
      <p class="card-kind">フォルダ</p>
      <h3 class="card-name">${escapeHtml(dir.name)}</h3>
      <div class="card-actions">
        <button class="btn-open">開く　›</button>
      </div>
    </div>
  `
  return card
}

function buildPdfCard(file, index) {
  const sizeKB      = (file.size / 1024).toFixed(1)
  const downloadUrl = file.download_url
  const viewUrl     = `https://${currentOwner}.github.io/${currentRepo}/${file.path}`

  const card = document.createElement('article')
  card.className = 'pdf-card'
  card.style.animationDelay = `${index * 60}ms`

  card.innerHTML = `
    <span class="print-no" aria-hidden="true">其の${kanjiNumber(index + 1)}</span>
    <div class="card-body">
      <p class="card-kind">PDF · ${sizeKB} KB</p>
      <h3 class="card-name">${escapeHtml(file.name)}</h3>
      <div class="card-actions">
        <button class="btn-view"
                onclick="viewPDF('${escapeHtml(viewUrl)}', '${escapeHtml(file.name)}')">
          閲覧
        </button>
        <a class="btn-download" href="${escapeHtml(downloadUrl)}"
           download="${escapeHtml(file.name)}" target="_blank">
          保存
        </a>
      </div>
    </div>
  `
  return card
}

// ── モーダル ──────────────────────────────────────────────────────────────────

function viewPDF(url, name) {
  document.getElementById('modal-title').textContent = name
  document.getElementById('pdf-viewer').src = url
  const modal = document.getElementById('modal')
  modal.classList.remove('hidden')
  document.body.style.overflow = 'hidden'
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden')
  document.getElementById('pdf-viewer').src = ''
  document.body.style.overflow = ''
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal() })

function handleModalClick(e) {
  if (e.target.id === 'modal') closeModal()
}

// ── ユーティリティ ────────────────────────────────────────────────────────────

function showError(msg) {
  const el = document.getElementById('error')
  el.textContent = msg
  el.classList.remove('hidden')
}

function updateItemCount(n) {
  const el = document.getElementById('item-count')
  if (!el) return
  el.textContent = n > 0 ? `全${kanjiNumber(n)}点` : ''
}

// 1 → 一, 12 → 十二, 36 → 三十六 (連作版画の番号)
function kanjiNumber(n) {
  if (n < 1 || n > 99) return String(n)
  const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  const tens = Math.floor(n / 10)
  const ones = n % 10
  const tensPart = tens === 0 ? '' : (tens === 1 ? '十' : digits[tens] + '十')
  return tensPart + digits[ones]
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
