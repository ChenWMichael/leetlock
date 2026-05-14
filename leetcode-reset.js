// Runs in MAIN world to access window.monaco (LeetCode's editor API).

function getSlug() {
  const m = location.pathname.match(/\/problems\/([^/]+)/)
  return m ? m[1] : null
}

async function fetchSnippets(slug) {
  const res = await fetch('https://leetcode.com/graphql', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: 'query($s:String!){question(titleSlug:$s){codeSnippets{langSlug code}}}',
      variables: { s: slug },
    }),
  })
  const json = await res.json()
  return json?.data?.question?.codeSnippets ?? []
}

function waitForEditor(ms = 10000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + ms
    const poll = () => {
      const editors = window.monaco?.editor?.getEditors()
      if (editors?.length) return resolve(editors[0])
      if (Date.now() > deadline) return reject(new Error('Monaco editor not found'))
      setTimeout(poll, 300)
    }
    poll()
  })
}

// Monaco language IDs → LeetCode langSlugs
const MONACO_TO_LC = {
  cpp: 'cpp', c: 'c', java: 'java', python: 'python3',
  javascript: 'javascript', typescript: 'typescript', csharp: 'csharp',
  go: 'golang', rust: 'rust', swift: 'swift', kotlin: 'kotlin',
  scala: 'scala', ruby: 'ruby', php: 'php',
}

async function resetToDefault() {
  const slug = getSlug()
  if (!slug) return

  const [editor, snippets] = await Promise.all([
    waitForEditor().catch(() => null),
    fetchSnippets(slug),
  ])

  if (!editor || !snippets.length) return

  // Wait for LeetCode to finish loading saved code into the editor before resetting.
  // LeetCode populates the editor asynchronously after Monaco appears — we watch for
  // content changes and fire once the editor has been stable for 1 second.
  await waitForEditorToSettle(editor)

  const monacoLang = editor.getModel()?.getLanguageId()
  const lcLang = MONACO_TO_LC[monacoLang] ?? monacoLang
  const snippet = snippets.find(s => s.langSlug === lcLang) ?? snippets[0]
  editor.setValue(snippet.code)
}

function waitForEditorToSettle(editor, settlePeriod = 500, timeout = 10000) {
  return new Promise(resolve => {
    let settleTimer = null
    let finished = false
    let disposable

    const finish = () => {
      if (finished) return
      finished = true
      disposable?.dispose()
      clearTimeout(settleTimer)
      resolve()
    }

    const bump = () => {
      clearTimeout(settleTimer)
      settleTimer = setTimeout(finish, settlePeriod)
    }

    disposable = editor.onDidChangeModelContent(bump)
    setTimeout(finish, timeout) // hard fallback
    bump() // always wait at least settlePeriod even if editor never changes
  })
}

// Intercept Next.js SPA navigation (more targeted than MutationObserver)
const originalPushState = history.pushState.bind(history)
history.pushState = function (...args) {
  originalPushState(...args)
  if (/\/problems\/[^/]+/.test(location.pathname)) {
    setTimeout(resetToDefault, 800)
  }
}

window.addEventListener('popstate', () => {
  if (/\/problems\/[^/]+/.test(location.pathname)) {
    setTimeout(resetToDefault, 800)
  }
})

// Initial load
if (/\/problems\/[^/]+/.test(location.pathname)) {
  resetToDefault()
}
