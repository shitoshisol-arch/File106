import { html, raw } from '../lib/html.js';
import { csrfField } from '../lib/csrf.js';
import { page, notice, errorList } from './layout.js';

function field({ name, label, type = 'text', value = '', autocomplete = '', required = true, hint = '' }) {
  return html`<label class="field">
    <span class="field-label">${label}</span>
    <input
      class="field-input"
      type="${type}"
      name="${name}"
      value="${value}"
      ${required ? raw('required') : raw('')}
      ${autocomplete ? raw(`autocomplete="${autocomplete}"`) : raw('')}
      ${name === 'password' || name === 'confirmPassword' ? raw('minlength="12"') : raw('')}
    >
    ${hint ? html`<span class="field-hint">${hint}</span>` : raw('')}
  </label>`;
}

export function registerPage({ session, errors = {}, values = {}, message = '' }) {
  const body = html`
    <section class="section archive-section">
      <p class="eyebrow">ACCESS REQUEST / NEW CUSTODIAN</p>
      <h1 class="archive-title">REGISTER</h1>
      <p class="lede">
        An account is required before a file can be opened. Nothing is charged and no wallet is
        touched until you link one deliberately.
      </p>

      ${notice('form', message)}
      ${errorList(errors)}

      <form method="post" action="/register" class="auth-form" autocomplete="on">
        ${csrfField(session)}
        ${field({ name: 'username', label: 'USERNAME', value: values.username || '', autocomplete: 'username' })}
        ${field({ name: 'email', label: 'EMAIL', type: 'email', value: values.email || '', autocomplete: 'email' })}
        ${field({
          name: 'password',
          label: 'PASSWORD',
          type: 'password',
          autocomplete: 'new-password',
          hint: 'At least 12 characters, mixing letters and numbers.',
        })}
        ${field({
          name: 'confirmPassword',
          label: 'CONFIRM PASSWORD',
          type: 'password',
          autocomplete: 'new-password',
        })}

        <label class="field field-check">
          <input type="checkbox" name="acceptTerms" value="1" ${values.acceptTerms ? raw('checked') : raw('')} required>
          <span>I accept the archive rules: one account per person, one wallet per account, and manual reward review.</span>
        </label>

        <button class="btn primary" type="submit">REQUEST ACCESS</button>
      </form>

      <p class="fine">Already registered? <a href="/login">SIGN IN</a></p>
    </section>`;

  return page({ title: 'FILE106 — REGISTER', body, session });
}

export function loginPage({ session, errors = {}, values = {}, message = '' }) {
  const body = html`
    <section class="section archive-section">
      <p class="eyebrow">TERMINAL / AUTHENTICATION</p>
      <h1 class="archive-title">SIGN IN</h1>

      ${notice('form', message)}
      ${errorList(errors)}

      <form method="post" action="/login" class="auth-form" autocomplete="on">
        ${csrfField(session)}
        ${field({ name: 'email', label: 'EMAIL', type: 'email', value: values.email || '', autocomplete: 'email' })}
        ${field({ name: 'password', label: 'PASSWORD', type: 'password', autocomplete: 'current-password' })}
        <button class="btn primary" type="submit">UNLOCK TERMINAL</button>
      </form>

      <p class="fine">No account? <a href="/register">REQUEST ACCESS</a></p>
    </section>`;

  return page({ title: 'FILE106 — SIGN IN', body, session });
}

export function verificationSentPage({ session, devLink = '' }) {
  const body = html`
    <section class="section archive-section">
      <p class="eyebrow">TRANSMISSION / PENDING</p>
      <h1 class="archive-title">VERIFY YOUR EMAIL</h1>
      <p class="lede">
        The archive sent a verification link to your address. Open it to activate the account,
        then sign in. The link expires in 24 hours.
      </p>

      ${devLink
        ? html`<div class="archive-notice" data-kind="dev">
            <strong>DEVELOPMENT MODE.</strong> No mail transport is configured, so the link is
            printed here and in the server log. In production it is only emailed.
            <p><a class="mono break" href="${devLink}">${devLink}</a></p>
          </div>`
        : raw('')}

      <p class="fine"><a href="/login">BACK TO SIGN IN</a></p>
    </section>`;

  return page({ title: 'FILE106 — VERIFY EMAIL', body, session });
}

export function linkProblemPage({ session, message }) {
  const body = html`
    <section class="section archive-section">
      <p class="eyebrow">TRANSMISSION / REJECTED</p>
      <h1 class="archive-title">LINK NOT ACCEPTED</h1>
      ${notice('form', message)}
      <p class="fine"><a href="/login">BACK TO SIGN IN</a></p>
    </section>`;

  return page({ title: 'FILE106 — LINK REJECTED', body, session });
}
