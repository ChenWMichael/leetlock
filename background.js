// NC_150, BLIND_75, PROBLEM_SETS, PROBLEM_ALL_MAP are defined in problems.js
importScripts('problems.js')

const RULE_ID_OFFSET = 1
const POINT_VALUE = { easy: 1, medium: 2, hard: 3 }
const SR_BASE_INTERVAL = { easy: 3, medium: 2, hard: 1 }
const SR_MULTIPLIER = { easy: 2.5, medium: 2.0, hard: 1.8 }

let bannedWebsites = []
let activeSet = 'nc150'
let wasUnlockedToday = false
let dailyState = { date: null, problems: [], completed: [] }
let streakState = { count: 0, lastCompletedDate: null }

// ── Blocking rules (declarativeNetRequest) ────────────────────────────────────
// Reads everything it needs from storage so it's safe to call from a fresh
// service worker wake-up where in-memory state hasn't been restored yet.

async function updateBlockingRules() {
  const [stored, existingRules] = await Promise.all([
    chrome.storage.local.get(['bannedWebsites', 'unlockedToday', 'todayProblems', 'completedToday']),
    chrome.declarativeNetRequest.getDynamicRules(),
  ])

  const sites = stored.bannedWebsites ?? bannedWebsites
  const problems = stored.todayProblems || []
  const completed = stored.completedToday || []
  const unlocked = stored.unlockedToday ||
    (problems.length > 0 && problems.every(p => completed.includes(p.slug)))

  const existingIds = existingRules.map(r => r.id)

  if (!unlocked && sites.length > 0) {
    const newRules = sites.map((site, i) => ({
      id: RULE_ID_OFFSET + i,
      priority: 1,
      action: { type: 'redirect', redirect: { extensionPath: '/blocked.html' } },
      condition: { requestDomains: [site], resourceTypes: ['main_frame'] },
    }))
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existingIds,
      addRules: newRules,
    })
  } else {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existingIds,
      addRules: [],
    })
  }
}

async function loadBannedWebsites() {
  const data = await chrome.storage.local.get('bannedWebsites')
  if (data.bannedWebsites === undefined) {
    bannedWebsites = [
      'x.com',
      'youtube.com',
      'facebook.com',
      'instagram.com',
      'reddit.com',
      'tiktok.com',
      'twitch.tv',
    ]
    await chrome.storage.local.set({ bannedWebsites })
  } else {
    bannedWebsites = data.bannedWebsites
  }
}

chrome.storage.onChanged.addListener(async changes => {
  if (changes.bannedWebsites) {
    bannedWebsites = changes.bannedWebsites.newValue || []
    await updateBlockingRules()
  }
  if (changes.customSet) PROBLEM_SETS.custom.problems = changes.customSet.newValue || []
  if (changes.activeSet) {
    activeSet = changes.activeSet.newValue || 'nc150'
    await initDailyState()
  }
})

// ── Problem fetching ──────────────────────────────────────────────────────────

async function fetchProblem(slug) {
  const resp = await fetch('https://leetcode.com/graphql', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: 'query($s:String!){question(titleSlug:$s){title difficulty}}',
      variables: { s: slug },
    }),
  })
  if (!resp.ok) throw new Error('Network error')
  const json = await resp.json()
  const q = json?.data?.question
  if (!q?.title) throw new Error('Problem not found')
  return { title: q.title, slug, difficulty: q.difficulty.toLowerCase() }
}

// Chrome requires returning true from onMessage to keep the channel open for
// async sendResponse — returning a Promise is a Firefox-only behavior.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'reset-progress') {
    initDailyState()
    return
  }
  if (message?.type === 'fetch-problem') {
    fetchProblem(message.slug)
      .then(sendResponse)
      .catch(() => sendResponse({ error: true }))
    return true // keep message channel open for async response
  }
})

// ── Daily state ───────────────────────────────────────────────────────────────

function getTodayStr() {
  return new Date().toLocaleDateString('en-CA')
}

function shiftLocalDate(dateStr, deltaDays) {
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + deltaDays)
  return date.toLocaleDateString('en-CA')
}

function sampleN(arr, n) {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n)
}

function pickProblems(pool, target) {
  const easy = pool.filter(p => p.difficulty === 'easy')
  const medium = pool.filter(p => p.difficulty === 'medium')
  const hard = pool.filter(p => p.difficulty === 'hard')

  for (let t = target; t >= 1; t--) {
    const combos = []
    for (let h = 0; h <= Math.floor(t / 3); h++) {
      for (let m = 0; m <= Math.floor((t - 3 * h) / 2); m++) {
        const e = t - 3 * h - 2 * m
        if (easy.length >= e && medium.length >= m && hard.length >= h) {
          combos.push({ e, m, h })
        }
      }
    }
    if (combos.length > 0) {
      const { e, m, h } = combos[Math.floor(Math.random() * combos.length)]
      return [...sampleN(easy, e), ...sampleN(medium, m), ...sampleN(hard, h)]
    }
  }
  return []
}

function generateProblems(setProblems, cycleKey, data, target) {
  const today = getTodayStr()
  const srData = data.srData || {}

  const dueReviews = setProblems.filter(p => {
    const sr = srData[p.slug]
    return sr && sr.nextReview <= today
  })
  const reviewSlugs = new Set(dueReviews.map(p => p.slug))

  const pickedReviews = pickProblems(dueReviews, target)
    .map(p => ({ ...p, isReview: true }))
  const reviewPoints = pickedReviews.reduce((sum, p) => sum + (POINT_VALUE[p.difficulty] || 1), 0)
  const remaining = Math.max(0, target - reviewPoints)

  const doneSlugs = new Set((data.allCompleted || []).map(p => p.slug))
  const firstPassRemaining = setProblems.filter(p => !doneSlugs.has(p.slug) && !reviewSlugs.has(p.slug))

  let newProblems = []
  let cycleRemaining = null

  if (remaining > 0) {
    if (firstPassRemaining.length > 0) {
      newProblems = pickProblems(firstPassRemaining, remaining)
    } else {
      cycleRemaining = data[cycleKey] || []
      if (cycleRemaining.length === 0) cycleRemaining = setProblems.map(p => p.slug)
      const cyclePool = setProblems.filter(p => cycleRemaining.includes(p.slug) && !reviewSlugs.has(p.slug))
      newProblems = pickProblems(cyclePool, remaining)
    }
  }

  return { problems: [...pickedReviews, ...newProblems], cycleRemaining }
}

async function initDailyState() {
  const today = getTodayStr()
  const data = await chrome.storage.local.get([
    'todayDate', 'allCompleted', 'pointTarget',
    'streakCount', 'streakLastCompletedDate',
    'activeSet', 'unlockedToday',
    'customSet',
    'srData',
    'cycleRemaining_blind75', 'cycleRemaining_nc150', 'cycleRemaining_custom',
    'todayProblems_blind75', 'completedToday_blind75',
    'todayProblems_nc150', 'completedToday_nc150',
    'todayProblems_custom', 'completedToday_custom',
  ])
  activeSet = data.activeSet || 'nc150'
  PROBLEM_SETS.custom.problems = data.customSet || []
  const setProblems = PROBLEM_SETS[activeSet]?.problems || PROBLEM_SETS.nc150.problems
  const cycleKey = `cycleRemaining_${activeSet}`
  const setProblemsKey = `todayProblems_${activeSet}`
  const setCompletedKey = `completedToday_${activeSet}`

  streakState = {
    count: data.streakCount || 0,
    lastCompletedDate: data.streakLastCompletedDate || null,
  }

  const newDay = data.todayDate !== today
  const setHasProblems = (data[setProblemsKey] || []).length > 0

  if (!newDay && setHasProblems) {
    wasUnlockedToday = data.unlockedToday || false
    const problems = data[setProblemsKey]
    const completed = data[setCompletedKey] || []
    dailyState = { date: today, problems, completed }
    await chrome.storage.local.set({ todayProblems: problems, completedToday: completed })
  } else {
    if (newDay) wasUnlockedToday = false
    else wasUnlockedToday = data.unlockedToday || false

    const target = data.pointTarget || 3
    const { problems, cycleRemaining } = generateProblems(setProblems, cycleKey, data, target)
    dailyState = { date: today, problems, completed: [] }

    const updates = {
      todayProblems: problems,
      completedToday: [],
      [setProblemsKey]: problems,
      [setCompletedKey]: [],
    }
    if (newDay) {
      updates.todayDate = today
      updates.unlockedToday = false
      for (const key of Object.keys(PROBLEM_SETS)) {
        if (key !== activeSet) {
          updates[`todayProblems_${key}`] = null
          updates[`completedToday_${key}`] = null
        }
      }
    }
    if (cycleRemaining !== null) {
      const picked = new Set(problems.map(p => p.slug))
      updates[cycleKey] = cycleRemaining.filter(s => !picked.has(s))
    }
    await chrome.storage.local.set(updates)
  }

  if (dailyState.date === today && isUnlocked()) {
    await updateStreakIfNeeded(today)
  }

  await updateBlockingRules()
}

function isUnlocked() {
  if (wasUnlockedToday) return true
  return dailyState.problems.length > 0 &&
    dailyState.problems.every(p => dailyState.completed.includes(p.slug))
}

async function updateStreakIfNeeded(today) {
  if (streakState.lastCompletedDate === today) return
  const yesterdayStr = shiftLocalDate(today, -1)
  streakState.count = streakState.lastCompletedDate === yesterdayStr ? streakState.count + 1 : 1
  streakState.lastCompletedDate = today
  await chrome.storage.local.set({
    streakCount: streakState.count,
    streakLastCompletedDate: streakState.lastCompletedDate,
  })
}

function recordSolved(slug) {
  const problem = PROBLEM_ALL_MAP.get(slug) || PROBLEM_SETS.custom.problems.find(p => p.slug === slug)
  if (!problem) return

  const assignedProblem = dailyState.problems.find(p => p.slug === slug)
  if (assignedProblem && !dailyState.completed.includes(slug)) {
    dailyState.completed.push(slug)
    chrome.storage.local.set({
      completedToday: dailyState.completed,
      [`completedToday_${activeSet}`]: dailyState.completed,
    })
    if (isUnlocked()) {
      wasUnlockedToday = true
      chrome.storage.local.set({ unlockedToday: true })
      updateStreakIfNeeded(dailyState.date)
      updateBlockingRules()
    }
  }

  chrome.storage.local.get(['allCompleted', 'srData']).then(data => {
    const all = data.allCompleted || []
    const srData = data.srData || {}
    const updates = {}

    if (!all.find(p => p.slug === slug)) {
      all.push({ title: problem.title, slug, difficulty: problem.difficulty })
      updates.allCompleted = all
    }

    const existing = srData[slug]
    const base = SR_BASE_INTERVAL[problem.difficulty] || 1
    const mult = SR_MULTIPLIER[problem.difficulty] || 2.0
    const newInterval = existing ? Math.round(existing.interval * mult) : base
    srData[slug] = {
      interval: newInterval,
      nextReview: shiftLocalDate(getTodayStr(), newInterval),
      reps: (existing?.reps || 0) + 1,
    }
    updates.srData = srData

    chrome.storage.local.set(updates)
  })
}

// ── Startup ───────────────────────────────────────────────────────────────────

loadBannedWebsites().then(() => initDailyState())

// ── LeetCode submission detection ─────────────────────────────────────────────
// Non-blocking listener — intercepts the page's own GraphQL call, re-issues it
// from the extension context (with credentials) to read the authenticated response.

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.initiator?.startsWith('chrome-extension://') ||
        details.initiator?.startsWith('moz-extension://')) return
    if (!details.requestBody) return
    const raw = details.requestBody.raw
    if (!raw) return
    let body
    try {
      body = JSON.parse(new TextDecoder().decode(raw[0].bytes))
    } catch {
      return
    }
    if (!body?.query?.includes('submissionDetails')) return

    fetch('https://leetcode.com/graphql', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(r => r.json())
      .then(json => {
        const submission = json?.data?.submissionDetails
        if (!submission) return
        if (submission.statusCode !== 10) return
        const slug = submission.question.titleSlug

        const today = getTodayStr()
        if (dailyState.date !== today) {
          initDailyState().then(() => recordSolved(slug))
        } else {
          recordSolved(slug)
        }
      })
  },
  { urls: ['*://leetcode.com/graphql*'], types: ['xmlhttprequest'] },
  ['requestBody']
)
