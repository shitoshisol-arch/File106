// The reward gate on the home page.
//
// This is the one part of the trust page that is not static: it reports whether
// the visitor in front of it could answer a file right now. Everything it says
// comes from the server — the holding is read from the chain by the node the
// app runs on, never sent up by the browser — and the response carrying it is
// marked no-store, so one visitor's gate is never served to another.
//
// The copy is deliberately careful about time. A balance read now says nothing
// about the balance at submission time, so the gate says so instead of implying
// a promise it cannot keep.

import { html } from '../lib/html.js';

// Replaced, in the static page, by the rendered gate. Kept as a plain HTML
// comment so site/index.html stays a valid page on its own (GitHub Pages and a
// bare `file://` open both still work).
export const HOME_GATE_MARKER = '<!-- ARCHIVE-GATE -->';

const FACT_LABELS = {
  open: 'FILES OPEN',
  onOffer: 'REWARD ON OFFER',
  gate: 'MINIMUM HOLDING',
};

function fact(label, value, unit = '') {
  return html`<div class="gate-fact">
      <dt>${label}</dt>
      <dd>${value}${unit ? html` <span>${unit}</span>` : ''}</dd>
    </div>`;
}

// One place decides what each state says, so a new state cannot be added
// without writing its copy and its way out.
const STATES = {
  sealed: () => ({
    title: 'THE VAULT IS SEALED',
    note: 'No file is open right now. When an archivist publishes one it appears in the archive, and this gate opens with it.',
    actions: [{ href: '/archive', label: 'READ THE ARCHIVE', primary: false }],
  }),

  anonymous: () => ({
    title: 'ACCOUNT REQUIRED',
    note: 'Register a free account, then link a wallet by signing a message. That signature proves the address is yours and moves no funds. The holding is read by the server, never taken from your browser.',
    actions: [
      { href: '/register', label: 'CREATE AN ACCOUNT', primary: true },
      { href: '/login', label: 'SIGN IN', primary: false },
      { href: '/archive', label: 'BROWSE THE FILES', primary: false },
    ],
  }),

  'no-wallet': ({ username }) => ({
    title: 'LINK A WALLET',
    note: `Signed in as ${username}. No wallet is linked yet, so there is no holding to read. Linking signs a message only — it never asks you to approve a transaction.`,
    actions: [
      { href: '/dashboard', label: 'LINK A WALLET', primary: true },
      { href: '/archive', label: 'BROWSE THE FILES', primary: false },
    ],
  }),

  unavailable: () => ({
    title: 'CHAIN UNREACHABLE',
    note: 'The RPC endpoint did not answer, so the gate cannot be judged this second. Nothing about your wallet has changed, and no file is closed by this. Try again shortly.',
    actions: [
      { href: '/', label: 'TRY AGAIN', primary: true },
      { href: '/archive', label: 'BROWSE THE FILES', primary: false },
    ],
  }),

  eligible: ({ balance, requirement }) => ({
    title: 'GATE OPEN · YOU HOLD ENOUGH',
    note: `You hold ${balance} F106 against a ${requirement} F106 requirement. The balance is re-read on-chain at the moment you submit, so keep holding it until then.`,
    actions: [{ href: '/archive', label: 'ENTER THE ARCHIVE', primary: true }],
  }),

  below: ({ balance, requirement }) => ({
    title: 'BELOW THE GATE',
    note: `You hold ${balance} F106; the lowest open gate is ${requirement} F106. Every open file is readable now — the answer terminal unlocks at the threshold, and that check happens server-side.`,
    actions: [
      { href: '/archive', label: 'READ THE FILES', primary: true },
      { href: '/dashboard', label: 'MY ARCHIVE', primary: false },
    ],
  }),
};

export function renderHomeGate({ open = 0, onOffer = '', gate = '', state = 'sealed', ...rest }) {
  const copy = (STATES[state] ?? STATES.sealed)({ ...rest, requirement: gate });

  const actions = copy.actions.map(
    (action) =>
      html`<a class="btn${action.primary ? ' primary' : ' ghost'}" href="${action.href}">${action.label}</a>`
  );

  return html`<section class="reward-gate" id="reward-gate" aria-labelledby="reward-gate-title">
        <div class="gate-top">
          <p class="eyebrow">01 / REWARD GATE</p>
          <h2 class="gate-title" id="reward-gate-title">Hold F106. Answer the file. Take the reward.</h2>
          <p class="gate-lede">
            The archive pays F106 for the right answer, and holding is the gate. Your balance is
            read from Solana by this server when it matters — no browser value is trusted, and no
            wallet is ever asked to send a transaction.
          </p>
        </div>

        ${open > 0
          ? html`<dl class="gate-facts">
              ${fact(FACT_LABELS.open, String(open))}
              ${fact(FACT_LABELS.onOffer, onOffer, 'F106')}
              ${fact(FACT_LABELS.gate, gate, 'F106')}
            </dl>`
          : ''}

        <div class="gate-state" data-state="${state}">
          <p class="gate-state-label">YOUR GATE</p>
          <h3 class="gate-state-title">${copy.title}</h3>
          <p class="gate-state-note">${copy.note}</p>
          <p class="gate-actions">${actions}</p>
        </div>
      </section>`;
}
