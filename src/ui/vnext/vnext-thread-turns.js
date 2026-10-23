// How a conversation turn looks. Execution, ownership, saving and recovery stay in
// vnext-generation-view.js; this module only builds the DOM for one turn from a plain model.
//
// Plain replies, clarifications, progress and routine errors are text under the author label
// with an inline action row (renderPlainTurn). Only a result that carries an image, a list of
// downloads or a form uses the richer block (renderGenerationCard). renderTurn picks between them.

export function setText(el, value) {
  el.textContent = value
}

// The conversation shows written sentences only: a bare code or a technical server reason
// (lower-case, snake_case identifiers) is replaced by the caller's plain fallback.
export function plainFailureText(value, fallback) {
  const text = String(value ?? '').trim()
  return /^[A-Z][^]*[.!?]$/.test(text) && !/\b[a-z0-9]+_[a-z0-9_]+\b/.test(text) ? text : fallback
}

export function actionButton({ label, kind, disabled, action, title, capability, figma }) {
  const node = document.createElement('button')
  node.type = 'button'
  node.className = `vnext-text-btn ${kind === 'primary' ? 'vnext-workflow-primary' : 'has-bg vnext-workflow-secondary'}`
  node.textContent = label
  node.disabled = Boolean(disabled)
  if (title) node.title = title
  if (action) node.dataset.genAction = action
  if (capability) {
    node.dataset.capability = capability
    node.dataset.capabilityStatus = disabled ? 'pending' : 'bound'
  }
  if (figma) node.dataset.figma = figma
  return node
}

export function toneIcon(tone) {
  const wrap = document.createElement('span')
  wrap.className = `vnext-workflow-tone is-${tone}`
  wrap.setAttribute('aria-hidden', 'true')
  wrap.innerHTML = tone === 'success'
    ? '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 8.5 6.5 11 12 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 6v3.5M8 11.5h.01M7.07 2.6 1.4 12.5A1.2 1.2 0 0 0 2.4 14.2h11.2a1.2 1.2 0 0 0 1.04-1.7L8.93 2.6a1.2 1.2 0 0 0-1.86 0Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  return wrap
}

function roleHeader(model) {
  const header = document.createElement('div')
  header.className = 'vnext-msg-head'
  const role = document.createElement('span')
  role.className = 'vnext-msg-role'
  setText(role, model.author || 'Assistant')
  if (model.tone && model.tone !== 'info') header.append(toneIcon(model.tone))
  header.append(role)
  return header
}

function progressBar(progress, tone) {
  const wrap = document.createElement('div')
  wrap.className = 'vnext-workflow-progress'
  const progressTone = progress.tone || tone
  if (progressTone) wrap.classList.add(`is-${progressTone}`)
  wrap.setAttribute('role', 'progressbar')
  wrap.setAttribute('aria-valuemin', '0')
  wrap.setAttribute('aria-valuemax', '100')
  wrap.setAttribute('aria-valuenow', String(Math.round(progress.value * 100)))
  wrap.setAttribute('aria-label', progress.label)
  const track = document.createElement('div')
  track.className = 'vnext-workflow-progress-track'
  const fill = document.createElement('div')
  fill.className = 'vnext-workflow-progress-fill'
  fill.style.width = `${Math.round(progress.value * 100)}%`
  track.append(fill)
  const label = document.createElement('p')
  label.className = 'vnext-workflow-progress-label'
  setText(label, progress.label)
  wrap.append(track, label)
  return wrap
}

// A richer component for results that benefit from it. The title text carries data-turn-title so
// a progress timer can update whichever form is on screen.
export function renderGenerationCard(root, model) {
  const card = document.createElement('article')
  card.className = `vnext-workflow-card vnext-msg is-assistant${model.tone ? ` is-${model.tone}` : ''}`
  card.dataset.figma = model.figma
  card.dataset.capability = model.capability
  card.dataset.capabilityStatus = 'bound'

  // The tone mark sits on the title (as in plain turns), so grouping under the author keeps it.
  const header = roleHeader({ ...model, tone: undefined })
  if (!model.externalRole) card.append(header)

  const title = document.createElement('h2')
  title.className = 'vnext-workflow-title'
  if (model.tone && model.tone !== 'info') title.append(toneIcon(model.tone))
  const titleText = document.createElement('span')
  titleText.dataset.turnTitle = 'true'
  setText(titleText, model.title)
  title.append(titleText)
  card.append(title)
  if (model.body) {
    const body = document.createElement('p')
    body.className = model.tone ? `vnext-workflow-body is-${model.tone}` : 'vnext-workflow-body'
    setText(body, model.body)
    card.append(body)
  }
  if (model.fields?.length) {
    const fields = document.createElement('div')
    fields.className = 'vnext-workflow-fields'
    fields.append(...model.fields)
    card.append(fields)
  }
  if (model.progress) card.append(progressBar(model.progress, model.tone))
  if (model.downloads?.length) {
    const list = document.createElement('div')
    list.className = 'vnext-workflow-downloads'
    list.dataset.capability = 'FILE-02'
    list.dataset.figma = '2855:2456'
    for (const item of model.downloads) {
      list.append(actionButton({
        label: item.label,
        kind: 'secondary',
        disabled: !item.available,
        action: item.available ? `download:${item.key}` : '',
        title: item.reason || model.downloadTitle,
        capability: 'FILE-02',
      }))
    }
    card.append(list)
  }
  if (model.actions?.length) {
    const actions = document.createElement('div')
    actions.className = 'vnext-workflow-actions'
    for (const action of model.actions) actions.append(actionButton(action))
    card.append(actions)
  }
  root.dataset.author = model.author || 'Assistant'
  root.replaceChildren(...(model.externalRole ? [header, card] : [card]))
  return card
}

// Conversational text under the author label: a reply, a question, progress or a routine
// notice. `title` is the main line; `body` an optional second line; `busy` marks progress.
// The action row is always present (empty rows are hidden by CSS) so recovery controls can
// be added to a note later.
export function renderPlainTurn(root, model) {
  const message = document.createElement('div')
  message.className = `vnext-msg is-assistant is-plain${model.tone ? ` is-${model.tone}` : ''}${model.busy ? ' is-busy' : ''}`
  message.dataset.figma = model.figma
  message.dataset.capability = model.capability
  message.dataset.capabilityStatus = 'bound'
  // The tone mark sits on the text line, so a turn grouped under the previous author keeps it.
  const text = document.createElement('p')
  text.className = model.body ? 'vnext-msg-text is-title' : 'vnext-msg-text'
  if (model.tone && model.tone !== 'info') text.append(toneIcon(model.tone))
  const title = document.createElement('span')
  title.dataset.turnTitle = 'true'
  setText(title, model.title)
  text.append(title)
  message.append(text)
  if (model.body) {
    const detail = document.createElement('p')
    detail.className = 'vnext-msg-detail'
    setText(detail, model.body)
    message.append(detail)
  }
  if (model.progress) message.append(progressBar(model.progress, model.tone))
  const actions = document.createElement('div')
  actions.className = 'vnext-msg-actions'
  for (const action of model.actions || []) actions.append(actionButton(action))
  message.append(actions)
  root.dataset.author = model.author || 'Assistant'
  root.replaceChildren(roleHeader({ ...model, tone: undefined }), message)
  return message
}

export function renderTurn(root, model) {
  const rich = Boolean(model.fields?.length || model.downloads?.length)
  return rich ? renderGenerationCard(root, { ...model, externalRole: true }) : renderPlainTurn(root, model)
}

// Consecutive turns by the same author show the name once (the CSS hides a continued header).
export function groupWithPrevious(wrap, previous, author) {
  wrap.dataset.author = author || 'Assistant'
  const continued = Boolean(previous && previous !== wrap && previous.classList?.contains?.('is-assistant')
    && previous.dataset?.author === wrap.dataset.author)
  if (continued) wrap.classList.add('is-continued')
  return continued
}

// The row a note's recovery controls belong in.
export function turnActions(root) {
  return root.querySelector('.vnext-msg-actions') || root.querySelector('.vnext-workflow-actions')
}
