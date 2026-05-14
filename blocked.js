const DIFF_LABEL = { easy: 'Easy', medium: 'Med', hard: 'Hard' }

function diffBadge(difficulty) {
  if (!difficulty) return ''
  return `<span class="diff diff-${difficulty}">${DIFF_LABEL[difficulty]}</span>`
}

function render(problems, completed) {
  const solved = problems.filter(p => completed.includes(p.slug)).length
  const allDone = problems.length > 0 && solved === problems.length

  const problemsEl = document.getElementById('problems')
  problemsEl.innerHTML = ''
  problems.forEach(problem => {
    const done = completed.includes(problem.slug)
    const div = document.createElement('div')
    div.className = 'problem' + (done ? ' solved' : '')
    div.innerHTML =
      `<span class="icon">${done ? '✓' : '○'}</span>` +
      `<div class="info">` +
        `<div class="title">${problem.title} ${diffBadge(problem.difficulty)}${problem.isReview ? ' <span class="review-badge">↻ review</span>' : ''}</div>` +
        `<a class="link" href="https://leetcode.com/problems/${problem.slug}/" target="_blank">Open on LeetCode ↗</a>` +
      `</div>`
    problemsEl.appendChild(div)
  })

  document.getElementById('progress').textContent = `${solved} / ${problems.length} solved`

  const btn = document.getElementById('continue')
  btn.disabled = !allDone
  if (allDone) {
    // Go back to wherever the user was trying to navigate before being blocked.
    // declarativeNetRequest replaces the navigation, so history.back() returns
    // to the previous page (or the new-tab page if none).
    btn.onclick = () => history.back()
  }
}

chrome.storage.local.get(['todayProblems', 'completedToday']).then(data => {
  render(data.todayProblems || [], data.completedToday || [])
})

// Live-update when a problem is solved while this page is open
chrome.storage.onChanged.addListener(() => {
  chrome.storage.local.get(['todayProblems', 'completedToday']).then(data => {
    render(data.todayProblems || [], data.completedToday || [])
  })
})
