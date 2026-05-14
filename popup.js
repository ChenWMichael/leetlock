const DIFF_LABEL = { easy: 'Easy', medium: 'Med', hard: 'Hard' }
const MIN_PTS = 1
const MAX_PTS = 9

function diffBadge(difficulty) {
  if (!difficulty) return ''
  return `<span class="diff diff-${difficulty}">${DIFF_LABEL[difficulty]}</span>`
}

function streakIcon(allDone) {
  return allDone ? '🔥' : '🪵'
}

function render(problems, completed, all, activeSet) {
  const solved = problems.filter(p => completed.includes(p.slug)).length
  const allDone = problems.length > 0 && solved === problems.length

  const badge = document.getElementById('badge')
  badge.textContent = allDone ? 'unlocked' : 'locked'
  badge.className = 'badge ' + (allDone ? 'unlocked' : 'locked')

  const problemsEl = document.getElementById('problems')
  problemsEl.innerHTML = ''
  problems.forEach(problem => {
    const done = completed.includes(problem.slug)
    const div = document.createElement('div')
    div.className = 'problem' + (done ? ' solved' : '')
    div.innerHTML =
      `<span class="icon">${done ? '✓' : '○'}</span>` +
      `<div class="info">` +
        `<div class="title">${problem.title} ${diffBadge(problem.difficulty)}</div>` +
        `<a class="link" href="https://leetcode.com/problems/${problem.slug}/" target="_blank">Open on LeetCode ↗</a>` +
      `</div>`
    problemsEl.appendChild(div)
  })

  document.getElementById('progress').textContent = `${solved} / ${problems.length} solved today`

  const setProblems = PROBLEM_SETS[activeSet]?.problems || []
  const setSlugSet = new Set(setProblems.map(p => p.slug))
  const setDoneCount = all.filter(p => setSlugSet.has(p.slug)).length
  document.getElementById('hist-header').textContent =
    `History (${setDoneCount} / ${setProblems.length})`

  const histEl = document.getElementById('history')
  histEl.innerHTML = ''
  if (all.length === 0) {
    histEl.innerHTML = '<div class="hist-empty">None yet</div>'
  } else {
    all.slice().reverse().forEach(problem => {
      const div = document.createElement('div')
      div.className = 'hist-item'
      div.innerHTML =
        `<span>✓</span>` +
        `<a href="https://leetcode.com/problems/${problem.slug}/" target="_blank">${problem.title}</a>` +
        diffBadge(problem.difficulty) +
        `<button class="remove-btn" data-slug="${problem.slug}" title="Unmark as done">×</button>`
      histEl.appendChild(div)
    })
  }
}

function loadAndRender() {
  chrome.storage.local.get(['todayProblems', 'completedToday', 'allCompleted', 'streakCount', 'activeSet', 'customSet']).then(data => {
    PROBLEM_SETS.custom.problems = data.customSet || []
    const problems = data.todayProblems || []
    const completed = data.completedToday || []
    const all = data.allCompleted || []
    const activeSet = data.activeSet || 'nc150'
    const solved = problems.filter(p => completed.includes(p.slug)).length
    const allDone = problems.length > 0 && solved === problems.length

    render(problems, completed, all, activeSet)
    document.getElementById('streak').textContent = `${streakIcon(allDone)} ${data.streakCount || 0} day streak`
  })
}

loadAndRender()

chrome.storage.onChanged.addListener(() => {
  loadAndRender()
})

// ── Settings toggle ──────────────────────────────────────────────────────────
const settingsToggle = document.getElementById('settings-toggle')
const mainView = document.getElementById('main-view')
const settingsView = document.getElementById('settings-view')

settingsToggle.addEventListener('click', () => {
  const openingSettings = mainView.classList.toggle('hidden')
  settingsView.classList.toggle('hidden', !openingSettings)
  settingsToggle.textContent = openingSettings ? '✕' : '⚙'
})

// ── Problem set selector ─────────────────────────────────────────────────────
let currentActiveSet = 'nc150'

function renderSetSelector(activeSet) {
  const el = document.getElementById('set-selector')
  el.innerHTML = ''
  Object.entries(PROBLEM_SETS).forEach(([key, set]) => {
    const empty = key === 'custom' && set.problems.length === 0
    const btn = document.createElement('button')
    btn.className = 'set-btn' + (key === activeSet ? ' active' : '')
    btn.textContent = set.name
    btn.dataset.set = key
    btn.disabled = empty
    if (empty) btn.title = 'Add problems in Custom problem set below'
    el.appendChild(btn)
  })
}

chrome.storage.local.get(['activeSet', 'customSet']).then(data => {
  currentActiveSet = data.activeSet || 'nc150'
  PROBLEM_SETS.custom.problems = data.customSet || []
  renderSetSelector(currentActiveSet)
  renderCustomList(PROBLEM_SETS.custom.problems)
})

document.getElementById('set-selector').addEventListener('click', e => {
  const btn = e.target.closest('.set-btn')
  if (!btn || btn.dataset.set === currentActiveSet) return
  currentActiveSet = btn.dataset.set
  renderSetSelector(currentActiveSet)
  chrome.storage.local.set({ activeSet: currentActiveSet })
})

// ── Custom problem set ───────────────────────────────────────────────────────
function parseSlug(input) {
  try {
    const url = new URL(input.includes('://') ? input : 'https://' + input)
    if (url.hostname.includes('leetcode.com')) {
      const m = url.pathname.match(/\/problems\/([^/]+)/)
      if (m) return m[1]
    }
  } catch {}
  if (/^[a-z0-9-]+$/.test(input)) return input
  return null
}

function showCustomStatus(msg, isError) {
  const el = document.getElementById('custom-status')
  el.textContent = msg
  el.style.color = isError ? '#ff6b6b' : '#555'
}

function renderCustomList(problems) {
  const toggle = document.getElementById('custom-list-toggle')
  const listEl = document.getElementById('custom-list')
  if (problems.length === 0) {
    toggle.classList.add('hidden')
    listEl.classList.remove('hidden')
    listEl.innerHTML = '<div class="url-empty">No problems added</div>'
    return
  }
  toggle.classList.remove('hidden')
  const isCollapsed = listEl.classList.contains('hidden')
  toggle.textContent = `${problems.length} problem${problems.length === 1 ? '' : 's'} ${isCollapsed ? '▸' : '▾'}`
  if (!isCollapsed) {
    listEl.innerHTML = ''
    problems.forEach(p => {
      const div = document.createElement('div')
      div.className = 'custom-item'
      div.innerHTML =
        `<span class="custom-title">${p.title}</span>` +
        diffBadge(p.difficulty) +
        `<button class="url-remove" data-slug="${p.slug}" title="Remove">×</button>`
      listEl.appendChild(div)
    })
  }
}

function addCustomProblem() {
  const input = document.getElementById('custom-input')
  const slug = parseSlug(input.value.trim())
  if (!slug) { showCustomStatus('Enter a valid LeetCode URL or slug', true); return }
  if (PROBLEM_SETS.custom.problems.some(p => p.slug === slug)) {
    showCustomStatus('Already in list', true); return
  }
  showCustomStatus('Fetching…', false)
  document.getElementById('custom-add').disabled = true
  chrome.runtime.sendMessage({ type: 'fetch-problem', slug })
    .then(problem => {
      if (!problem || problem.error) throw new Error('Problem not found')
      const updated = [...PROBLEM_SETS.custom.problems, problem]
      PROBLEM_SETS.custom.problems = updated
      return chrome.storage.local.set({ customSet: updated })
    })
    .then(() => {
      input.value = ''
      showCustomStatus('', false)
      renderCustomList(PROBLEM_SETS.custom.problems)
      renderSetSelector(currentActiveSet)
    })
    .catch(() => showCustomStatus('Problem not found', true))
    .finally(() => { document.getElementById('custom-add').disabled = false })
}

document.getElementById('custom-list-toggle').addEventListener('click', () => {
  const listEl = document.getElementById('custom-list')
  listEl.classList.toggle('hidden')
  renderCustomList(PROBLEM_SETS.custom.problems)
})

document.getElementById('custom-add').addEventListener('click', addCustomProblem)
document.getElementById('custom-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') addCustomProblem()
})

document.getElementById('custom-list').addEventListener('click', e => {
  const btn = e.target.closest('.url-remove')
  if (!btn) return
  const updated = PROBLEM_SETS.custom.problems.filter(p => p.slug !== btn.dataset.slug)
  PROBLEM_SETS.custom.problems = updated
  chrome.storage.local.set({ customSet: updated }).then(() => {
    renderCustomList(updated)
    renderSetSelector(currentActiveSet)
  })
})

// ── Point target adjuster ────────────────────────────────────────────────────
let pointTarget = 3

function updatePtsDisplay() {
  document.getElementById('pts-display').textContent = `${pointTarget} pts`
  document.getElementById('pts-dec').disabled = pointTarget <= MIN_PTS
  document.getElementById('pts-inc').disabled = pointTarget >= MAX_PTS
}

chrome.storage.local.get('pointTarget').then(data => {
  pointTarget = data.pointTarget || 3
  updatePtsDisplay()
})

document.getElementById('pts-dec').addEventListener('click', () => {
  if (pointTarget <= MIN_PTS) return
  pointTarget--
  updatePtsDisplay()
  chrome.storage.local.set({ pointTarget })
})

document.getElementById('pts-inc').addEventListener('click', () => {
  if (pointTarget >= MAX_PTS) return
  pointTarget++
  updatePtsDisplay()
  chrome.storage.local.set({ pointTarget })
})

// ── Unmark individual problem ────────────────────────────────────────────────
document.getElementById('history').addEventListener('click', e => {
  const btn = e.target.closest('.remove-btn')
  if (!btn) return
  chrome.storage.local.get('allCompleted').then(data => {
    const all = (data.allCompleted || []).filter(p => p.slug !== btn.dataset.slug)
    chrome.storage.local.set({ allCompleted: all }).then(loadAndRender)
  })
})

// ── Blocked sites ────────────────────────────────────────────────────────────
function renderUrlList(urls) {
  const listEl = document.getElementById('url-list')
  listEl.innerHTML = ''
  if (urls.length === 0) {
    listEl.innerHTML = '<div class="url-empty">No sites blocked</div>'
    return
  }
  urls.forEach(url => {
    const div = document.createElement('div')
    div.className = 'url-item'
    div.innerHTML = `<span>${url}</span><button class="url-remove" data-url="${url}">×</button>`
    listEl.appendChild(div)
  })
}

chrome.storage.local.get('bannedWebsites').then(data => {
  renderUrlList(data.bannedWebsites || [])
})

function addUrl() {
  const input = document.getElementById('url-input')
  const raw = input.value.trim()
  if (!raw) return
  let hostname
  try {
    hostname = new URL(raw.includes('://') ? raw : 'https://' + raw).hostname
  } catch { return }
  if (!hostname) return
  input.value = ''
  chrome.storage.local.get('bannedWebsites').then(data => {
    const urls = data.bannedWebsites || []
    if (urls.includes(hostname)) return
    urls.push(hostname)
    chrome.storage.local.set({ bannedWebsites: urls }).then(() => renderUrlList(urls))
  })
}

document.getElementById('url-add').addEventListener('click', addUrl)
document.getElementById('url-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') addUrl()
})

document.getElementById('url-list').addEventListener('click', e => {
  const btn = e.target.closest('.url-remove')
  if (!btn) return
  chrome.storage.local.get('bannedWebsites').then(data => {
    const urls = (data.bannedWebsites || []).filter(u => u !== btn.dataset.url)
    chrome.storage.local.set({ bannedWebsites: urls }).then(() => renderUrlList(urls))
  })
})

// ── Reset all progress (two-step confirmation) ───────────────────────────────
let resetPending = false
let resetTimer = null
const resetBtn = document.getElementById('reset-btn')

resetBtn.addEventListener('click', () => {
  if (!resetPending) {
    resetPending = true
    resetBtn.textContent = 'Tap again to confirm'
    resetBtn.classList.add('confirm')
    resetTimer = setTimeout(() => {
      resetPending = false
      resetBtn.textContent = 'Reset all progress'
      resetBtn.classList.remove('confirm')
    }, 3000)
  } else {
    clearTimeout(resetTimer)
    resetPending = false
    resetBtn.textContent = 'Reset all progress'
    resetBtn.classList.remove('confirm')
    chrome.storage.local.set({
      allCompleted: [],
      completedToday: [],
      todayDate: null,
      todayProblems: [],
      todayProblems_blind75: null,
      completedToday_blind75: null,
      todayProblems_nc150: null,
      completedToday_nc150: null,
      todayProblems_custom: null,
      completedToday_custom: null,
      cycleRemaining_blind75: [],
      cycleRemaining_nc150: [],
      cycleRemaining_custom: [],
      unlockedToday: false,
      streakCount: 0,
      streakLastCompletedDate: null,
    }).then(() => chrome.runtime.sendMessage({ type: 'reset-progress' }))
      .then(loadAndRender)
  }
})
