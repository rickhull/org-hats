import { createPlayground } from './model.js';

const operation = document.querySelector('#operation');
const actor = document.querySelector('#actor');
const hat = document.querySelector('#hat');
const notice = document.querySelector('#notice');
const envelope = document.querySelector('#envelope-state');
const sites = document.querySelector('#sites');
const grants = document.querySelector('#grants');
const policy = document.querySelector('#read-policy');
const probeResult = document.querySelector('#probe-result');
const controls = [...document.querySelectorAll('button, select')];
let playground;
let state;

const escape = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const yesNo = (value, yes, no) => `<span class="${value ? 'yes' : 'no'}">${value ? yes : no}</span>`;
const time = value => value == null ? 'Not issued' : new Date(value * 1000).toLocaleString();
const readPolicies = {
  'granted-teams': 'Organizations of teams reached by the person’s grants',
  'all-participating': 'All organizations participating in the operation',
};

function renderTeam(team) {
  return `<div class="team"><div class="team-name"><strong>${escape(team.label)}</strong><span>${escape(team.organizationLabel)}</span></div>
    <div class="decisions"><div class="decision"><strong>Read</strong>${yesNo(team.readable, 'Allowed', 'Denied')}</div><div class="decision"><strong>Team reach</strong>${yesNo(team.reachable, 'Reachable', 'Not reachable')}</div>
    <div class="decision actions-cell"><strong>Actions in worn hat</strong>${team.actions.length ? escape(team.actions.join(', ')) : '<span class="no">None allowed</span>'}</div></div></div>`;
}

function render(view) {
  const expanded = state?.operation.id === view.operation.id
    ? new Set([...sites.querySelectorAll('details[open]')].map(item => item.dataset.site)) : new Set();
  state = view;
  operation.innerHTML = view.operations.map(item => `<option value="${escape(item.id)}">${escape(item.name)}</option>`).join('');
  operation.value = view.operation.id;
  actor.innerHTML = view.actors.map(person => `<option value="${escape(person.id)}">${escape(person.label)} · ${escape(person.organization)}</option>`).join('');
  actor.value = view.selectedActorId;
  const selectedGrant = view.selectedHat?.grantId;
  const available = view.hats.some(item => item.grantId === selectedGrant);
  hat.innerHTML = `${available ? '' : '<option value="">Choose an available hat</option>'}${view.hats.map(item => `<option value="${escape(item.grantId)}">${escape(item.role)} · ${escape(item.targetLabel)}</option>`).join('')}`;
  hat.value = available ? selectedGrant : '';

  const worn = view.selectedHat ? `${escape(view.selectedHat.role)} · ${escape(view.selectedHat.targetLabel)}` : 'None issued';
  const verification = view.verification === 'valid' ? 'Valid' : `Unavailable: ${escape(view.verification)}`;
  envelope.innerHTML = `<dl>
    <div><dt>Operation</dt><dd>${escape(view.operation.name)}</dd></div>
    <div><dt>Worn hat</dt><dd>${worn}</dd></div>
    <div><dt>Verification</dt><dd>${verification}</dd></div>
    <div><dt>Issued</dt><dd>${time(view.issuedAt)}</dd></div>
    <div><dt>Expires</dt><dd>${time(view.expiresAt)}</dd></div>
    <div><dt>Model time</dt><dd>${time(view.now)}</dd></div>
    <div><dt>Last refresh</dt><dd>${escape(view.refreshOutcome ?? 'Not attempted')}</dd></div>
  </dl>`;

  policy.textContent = `Organization read policy: ${readPolicies[view.operation.readPolicy] ?? view.operation.readPolicy}.`;
  probeResult.textContent = view.bindingProbe === null ? 'Other-operation check not attempted.'
    : view.bindingProbe === 'wrong-binding' ? 'Other-operation check: denied (wrong operation binding). The current envelope is unchanged.'
    : `Other-operation check: ${view.bindingProbe}. The current envelope is unchanged.`;
  sites.innerHTML = view.sites.map(site => {
    const teams = view.teams.filter(team => team.siteId === site.id);
    const remaining = teams.slice(4);
    return `<article class="site"><div class="site-header"><h3>${escape(site.label)}</h3>${yesNo(site.configurable, 'Configuration allowed', 'Configuration denied')}</div>
      ${teams.length ? teams.slice(0, 4).map(renderTeam).join('') : '<p class="team hint">No teams at this site.</p>'}
      ${remaining.length ? `<details data-site="${escape(site.id)}"${expanded.has(site.id) ? ' open' : ''}><summary>Show remaining ${remaining.length} ${remaining.length === 1 ? 'team' : 'teams'} at ${escape(site.label)}</summary>${remaining.map(renderTeam).join('')}</details>` : ''}</article>`;
  }).join('');
  grants.innerHTML = view.grants.length ? `<ul class="grant-list">${view.grants.map(grant => `<li><strong>${escape(grant.actorLabel)} · ${escape(grant.role)}</strong><small>${escape(grant.targetLabel)} · ${grant.revoked ? 'Revoked' : 'Active'}${grant.primary ? ' · Primary' : ''}</small></li>`).join('')}</ul>` : '<p class="hint">No grants to show.</p>';
  notice.classList.remove('error');
  notice.textContent = view.message;
}

function setPending(pending) {
  controls.forEach(control => { control.disabled = pending; });
  if (!pending) {
    if (!state) {
      controls.forEach(control => { control.disabled = control.id !== 'reset' && control.dataset.step !== 'reset'; });
    } else {
      hat.disabled = state.hats.length === 0;
      document.querySelector('#revoke').disabled = !state.selectedHat;
    }
  }
}

async function run(action) {
  setPending(true);
  try {
    if (action === 'reset') {
      playground = await createPlayground();
      render(await playground.view());
    } else {
      render(await action());
    }
  } catch (error) {
    notice.classList.add('error');
    notice.textContent = `Could not complete that action: ${error instanceof Error ? error.message : String(error)}. Try again or reset the playground.`;
    if (state) {
      operation.value = state.operation.id;
      actor.value = state.selectedActorId;
      hat.value = state.hats.some(item => item.grantId === state.selectedHat?.grantId) ? state.selectedHat.grantId : '';
    }
  } finally {
    setPending(false);
  }
}

operation.addEventListener('change', () => run(() => playground.chooseOperation(operation.value)));
actor.addEventListener('change', () => run(() => playground.chooseActor(actor.value)));
hat.addEventListener('change', () => { if (hat.value) run(() => playground.selectHat(hat.value)); });
document.querySelector('#reset').addEventListener('click', () => run('reset'));
document.querySelector('#revoke').addEventListener('click', () => run(() => playground.revokeHat()));
document.querySelector('#refresh').addEventListener('click', () => run(() => playground.refresh()));
document.querySelector('#expire').addEventListener('click', () => run(() => playground.expire()));
document.querySelector('#probe').addEventListener('click', () => run(() => playground.probeOtherOperation()));
document.querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => {
  const action = button.dataset.step;
  if (action === 'reset') run('reset');
  else run(() => ({
    revoke: () => playground.revokeHat(), refresh: () => playground.refresh(), expire: () => playground.expire(),
    other: () => playground.chooseOperation(state.operations.find(item => item.id !== state.operation.id).id),
    probe: () => playground.probeOtherOperation(),
  })[action]());
}));

run('reset');
