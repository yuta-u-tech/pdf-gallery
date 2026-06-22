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
      showError('PDFファイルもフォルダも見つかりませんでした。')
      return
    }

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
  const card = document.createElement('div')
  card.className = 'pdf-card folder-card'
  card.style.animationDelay = `${index * 60}ms`
  card.addEventListener('click', () => openFolder(dir.name, dir.path))

  card.innerHTML = `
    <div class="card-band folder-band"></div>
    <div class="card-body">
      <div class="card-icon">
        <svg viewBox="0 0 52 44" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M2 10 L2 42 L50 42 L50 16 L24 16 L19 10 Z"
                fill="#F2EBD9" stroke="#0D3060" stroke-width="2" stroke-linejoin="round"/>
          <path d="M2 16 L50 16" stroke="#0D3060" stroke-width="2"/>
        </svg>
      </div>
      <div class="card-info">
        <p class="card-name">${escapeHtml(dir.name)}</p>
        <p class="card-size">フォルダ</p>
      </div>
      <div class="card-actions">
        <button class="btn-view btn-open">開く　›</button>
      </div>
    </div>
  `
  return card
}

function buildPdfCard(file, index) {
  const sizeKB      = (file.size / 1024).toFixed(1)
  const downloadUrl = file.download_url
  const viewUrl     = `https://${currentOwner}.github.io/${currentRepo}/${file.path}`

  const card = document.createElement('div')
  card.className = 'pdf-card'
  card.style.animationDelay = `${index * 60}ms`

  card.innerHTML = `
    <div class="card-band"></div>
    <div class="card-body">
      <div class="card-icon">
        <svg viewBox="0 0 40 50" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M5 0 L30 0 L40 10 L40 50 L5 50 Z" fill="#FDFAF2" stroke="#0D3060" stroke-width="2"/>
          <path d="M30 0 L30 10 L40 10" fill="none" stroke="#0D3060" stroke-width="2"/>
          <text x="12" y="34" font-family="serif" font-size="11" fill="#C94040" font-weight="bold">PDF</text>
        </svg>
      </div>
      <div class="card-info">
        <p class="card-name">${escapeHtml(file.name)}</p>
        <p class="card-size">${sizeKB} KB</p>
      </div>
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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
