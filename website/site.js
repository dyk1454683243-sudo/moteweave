const localCommands = document.querySelector('#local-commands')
const copyButton = document.querySelector('#copy-commands')
const copyStatus = document.querySelector('#copy-status')
const menuToggle = document.querySelector('#menu-toggle')
const siteNav = document.querySelector('#site-navigation')
const siteHeader = document.querySelector('[data-site-header]')

function localInstallCommands() {
  const displayed = localCommands?.innerText ?? ''
  return displayed
    .split('\n')
    .map((line) => line.replace(/^\$\s*/, '').trim())
    .filter(Boolean)
    .join('\n')
}

function setMenu(open) {
  siteNav?.classList.toggle('is-open', open)
  menuToggle?.setAttribute('aria-expanded', String(open))
}

copyButton?.addEventListener('click', async () => {
  const commands = localInstallCommands()
  try {
    await navigator.clipboard.writeText(commands)
    if (copyStatus) copyStatus.textContent = 'Copied the local start commands.'
    if (copyButton) copyButton.textContent = 'Copied'
  } catch {
    if (copyStatus) copyStatus.textContent = 'The browser did not allow copying. Select the commands above.'
  }
  window.setTimeout(() => {
    if (copyButton) copyButton.textContent = 'Copy commands'
  }, 1800)
})

menuToggle?.addEventListener('click', () => {
  setMenu(menuToggle.getAttribute('aria-expanded') !== 'true')
})

siteNav?.addEventListener('click', (event) => {
  if (event.target.closest('a')) setMenu(false)
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setMenu(false)
})

function markHeader() {
  siteHeader?.classList.toggle('is-scrolled', window.scrollY > 8)
}

markHeader()
window.addEventListener('scroll', markHeader, { passive: true })
