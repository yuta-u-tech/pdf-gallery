let currentOwner = CONFIG.owner
let currentRepo = CONFIG.repo
let currentPath = CONFIG.path

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('repo-input').value = `${CONFIG.owner}/${CONFIG.repo}`
  document.getElementById('path-input').value = CONFIG.path
  document.getElementById('site-title').textContent = CONFIG.siteTitle
  document.getElementById('site-subtitle').textContent = CONFIG.siteSubtitle
  document.title = CONFIG.siteTitle

  if (CONFIG.owner !== 'OWNER') {
    loadPDFs()
  }
})

async function loadPDFs() {
  const repoVal = document.getElementById('repo-input').value.trim()
  const pathVal = document.getElementById('path-input').value.trim()

  if (!repoVal.includes('/')) {
    showError('リポジトリは "owner/repo" の形式で入力してください。')
    return
  }

  const [owner, repo] = repoVal.split('/')
  currentOwner = owner
  currentRepo = repo
  currentPath = pathVal

  await fetchContents(owner, repo, pathVal)
}

async function fetchContents(owner, repo, path) {
  const grid = document.getElementById('pdf-grid')
  const loading = document.getElementById('loading')
  const errorEl = document.getElementById('error')

  grid.innerHTML = ''
  errorEl.classList.add('hidden')
  loading.classList.remove('hidden')

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`

  try {
    const res = await fetch(url)
    if (!res.ok) {
      const msg = res.status === 404
        ? 'リポジトリまたはパスが見つかりません。'
        : `GitHub API エラー: ${res.status}`
      throw new Error(msg)
    }

    const items = await res.json()
    const pdfs = Array.isArray(items)
      ? items.filter(f => f.type === 'file' && f.name.toLowerCase().endsWith('.pdf'))
      : []

    loading.classList.add('hidden')

    if (pdfs.length === 0) {
      showError('PDFファイルが見つかりませんでした。')
      return
    }

    pdfs.forEach((file, i) => {
      const card = buildCard(file, i)
      grid.appendChild(card)
    })
  } catch (err) {
    loading.classList.add('hidden')
    showError(err.message)
  }
}

function buildCard(file, index) {
  const sizeKB = (file.size / 1024).toFixed(1)
  const downloadUrl = file.download_url
  // raw.githubusercontent.com は iframe 埋め込み不可のため
  // 同リポジトリなら GitHub Pages URL でプレビューする
  const viewUrl = `https://${currentOwner}.github.io/${currentRepo}/${file.path}`

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
        <button class="btn-view" onclick="viewPDF('${escapeHtml(viewUrl)}', '${escapeHtml(file.name)}')">
          閲覧
        </button>
        <a class="btn-download" href="${escapeHtml(downloadUrl)}" download="${escapeHtml(file.name)}" target="_blank">
          保存
        </a>
      </div>
    </div>
  `
  return card
}

function viewPDF(url, name) {
  const modal = document.getElementById('modal')
  document.getElementById('modal-title').textContent = name
  const viewer = document.getElementById('pdf-viewer')
  viewer.src = url
  modal.classList.remove('hidden')
  modal.classList.add('visible')
  document.body.style.overflow = 'hidden'
}

function closeModal() {
  const modal = document.getElementById('modal')
  modal.classList.remove('visible')
  modal.classList.add('hidden')
  document.getElementById('pdf-viewer').src = ''
  document.body.style.overflow = ''
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal()
})

function handleModalClick(e) {
  if (e.target.id === 'modal') closeModal()
}

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
