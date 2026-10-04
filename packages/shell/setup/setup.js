/**
 * The first-run sheet.
 *
 * It asks one question and hands the answer to the shell, which writes it where
 * the harness reads credentials. The page never stores anything itself and has
 * no network access of its own — it cannot, under the page's own policy — so the
 * key goes exactly one place.
 *
 * The key is checked before it is saved. A rejected key at this point is a
 * sentence on this sheet; the same key discovered later is a lesson that fails
 * to start, which is a much worse place to learn about it.
 */

const form = document.getElementById('form')
const keyField = document.getElementById('key')
const providerField = document.getElementById('provider')
const goButton = document.getElementById('go')
const problem = document.getElementById('problem')
const whereFile = document.getElementById('where-file')

const api = globalThis.mimirSetup

if (!api) {
  showProblem('This window was opened without the shell behind it, so nothing can be saved.')
} else {
  api
    .describe()
    .then((info) => {
      if (info?.credentialsPath) whereFile.textContent = info.credentialsPath
    })
    .catch(() => {})
}

function showProblem(message) {
  problem.textContent = message
  problem.hidden = false
}

function clearProblem() {
  problem.hidden = true
}

/** Opens the provider's key page in the real browser, not in this window. */
document.getElementById('where').addEventListener('click', (event) => {
  event.preventDefault()
  api?.openExternal('https://platform.deepseek.com/api_keys')
})

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  clearProblem()

  const apiKey = keyField.value.trim()
  if (!apiKey) {
    showProblem('Paste a key first.')
    /**
 * The mark, in the variant that suits the appearance.
 *
 * Done here rather than in the stylesheet because `content: url(...)` applies to
 * pseudo-elements and does nothing on an `<img>`, which is how the dark mark was
 * first attempted.
 */
const mark = document.querySelector('.mark')
if (mark) {
  const dark = window.matchMedia('(prefers-color-scheme: dark)')
  const paint = () => {
    mark.src = dark.matches ? 'art/mark-light.png' : 'art/mark.png'
  }
  paint()
  dark.addEventListener('change', paint)
}

keyField.focus()
    return
  }

  goButton.disabled = true
  goButton.textContent = 'Checking…'

  try {
    const result = await api.connect({ provider: providerField.value, apiKey })
    if (!result?.ok) {
      showProblem(result?.error ?? 'That key was not accepted.')
      goButton.disabled = false
      goButton.textContent = 'Start learning'
      return
    }
    goButton.textContent = 'Starting…'
    // The shell closes this window and opens the vault.
  } catch (error) {
    showProblem(error instanceof Error ? error.message : String(error))
    goButton.disabled = false
    goButton.textContent = 'Start learning'
  }
})

keyField.focus()
