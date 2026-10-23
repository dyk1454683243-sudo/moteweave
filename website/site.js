const localCommands = document.querySelector('#local-commands')
const copyButton = document.querySelector('#copy-commands')
const copyStatus = document.querySelector('#copy-status')

function localInstallCommands() {
  const displayed = localCommands?.innerText ?? ''
  return displayed
    .split('\n')
    .map((line) => line.replace(/^\$\s*/, '').trim())
    .filter(Boolean)
    .join('\n')
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
