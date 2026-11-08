import { createActivationLesson } from './activation-model.js';

const statePanel = document.querySelector('#state');
const notice = document.querySelector('#notice');
const events = document.querySelector('#events');
const controls = [...document.querySelectorAll('button')];
let lesson;
let state;

const escape = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const time = value => value == null ? 'Not issued' : new Date(value * 1000).toLocaleString();
const result = value => value == null ? 'Not attempted' : escape(value);
const row = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;

function render(view) {
  state = view;
  const activationUsable = view.activation.usable === null ? 'Not requested' : view.activation.usable ? 'Yes' : 'No';
  statePanel.innerHTML = `<h3>Actor</h3><dl>
    ${row('Operation', escape(view.operationName))}
    ${row('Person', `${escape(view.actor.label)} · ${escape(view.actor.organization)}`)}
    ${row('Actor record', view.actor.exists ? 'Created' : 'Not created')}
  </dl><h3>Identity link</h3><dl>
    ${row('Principal link', view.linked ? 'Linked' : 'Not linked')}
    ${row('Activation requested', view.activation.requested ? 'Yes' : 'No')}
    ${row('Activation usable', activationUsable)}
    ${row('Last acceptance', result(view.activation.acceptance))}
  </dl><h3>Hat grant</h3><dl>
    ${row('Grant', view.grant.present ? `${escape(view.grant.role)} · ${escape(view.grant.targetLabel)}` : 'Not present')}
  </dl><h3>Latest requests</h3><dl>
    ${row('Access issuance', result(view.access.issuance))}
    ${row('Refresh', result(view.access.refresh))}
  </dl><h3>Retained envelope</h3><dl>
    ${row('Verification', view.access.verification === 'none' ? 'No envelope' : escape(view.access.verification))}
    ${row('Observe Yard crew', view.access.mayObserve ? 'Allowed' : 'Not allowed')}
    ${row('Issued', time(view.access.issuedAt))}
    ${row('Expires', time(view.access.expiresAt))}
    ${row('Model time', time(view.now))}
  </dl>`;
  events.innerHTML = view.events.length ? `<ol class="events">${view.events.map(event => `<li><strong>${escape(event.action)}</strong><span>${escape(event.outcome)}</span></li>`).join('')}</ol>` : '<p class="hint">No actions yet.</p>';
  notice.classList.remove('error');
  notice.textContent = view.message;
}

function setPending(pending) {
  controls.forEach(control => { control.disabled = pending; });
  if (pending) return;
  if (!state) {
    controls.forEach(control => { control.disabled = control.id !== 'reset'; });
    return;
  }
  document.querySelector('#createActor').disabled = state.actor.exists;
  document.querySelector('#activate').disabled = !state.actor.exists || state.activation.requested;
  document.querySelector('#grantHat').disabled = !state.actor.exists || state.grant.present;
  document.querySelector('#unlink').disabled = !state.linked;
  document.querySelector('#expire').disabled = state.access.expiresAt == null;
  document.querySelector('#replay').disabled = !state.activation.requested;
  document.querySelector('#tryOtherSubject').disabled = !state.activation.requested;
}

async function run(action) {
  setPending(true);
  try {
    if (action === 'reset') {
      lesson = await createActivationLesson();
      render(await lesson.view());
    } else {
      render(await lesson[action]());
    }
  } catch (error) {
    notice.classList.add('error');
    notice.textContent = `Could not complete that action: ${error instanceof Error ? error.message : String(error)}. Try again or start fresh.`;
  } finally {
    setPending(false);
  }
}

controls.forEach(button => button.addEventListener('click', () => run(button.id)));
run('reset');
