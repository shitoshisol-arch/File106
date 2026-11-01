// Shared chrome for every server-rendered page. Reuses the trust page's
// design tokens from site/styles.css so the archive reads as the same product.

import { html, raw } from '../lib/html.js';
import { csrfField } from '../lib/csrf.js';

export function page({ title, body, session, signedIn = false, signedInName = '', scripts = [] }) {
  const csrf = session ? csrfField(session) : raw('');

  return html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="theme-color" content="#080a0c">
  <meta name="robots" content="noindex">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <div class="wrap">
    <header class="topbar">
      <div class="topbar-left">
        <span class="live-dot" aria-hidden="true"></span>
        <span>THE FILE106 ARCHIVE</span>
        <span class="sep">/</span>
        <span>${signedIn ? 'AUTHORIZED' : 'PUBLIC TERMINAL'}</span>
      </div>
      <nav class="topbar-right archive-nav" aria-label="Archive">
        <a href="/">HOME</a>
        ${signedIn
          ? html`<a href="/dashboard">MY ARCHIVE</a>
              <form method="post" action="/logout" class="nav-form">
                ${csrf}
                <button type="submit" class="nav-button">SIGN OUT</button>
              </form>`
          : html`<a href="/login">SIGN IN</a><a href="/register">REGISTER</a>`}
      </nav>
    </header>

    <main id="main">${body}</main>

    <footer>
      <div class="footer-top">
        <span>FILE106 / F106 · THE ARCHIVE</span>
        <span class="sep">/</span>
        <a href="/">Trust page</a>
      </div>
      <p>
        This terminal answers ${signedInName ? 'signed-in participants' : 'public visitors'} only.
        Sessions use a single first-party cookie; there are no trackers or third-party scripts.
        Rewards are paid manually by the archive after on-chain verification — never automatically.
      </p>
    </footer>
  </div>
  ${scripts.map((src) => html`<script src="${src}" defer></script>`)}
</body>
</html>`;
}

export function notice(key, text) {
  if (!text) return raw('');
  return html`<p class="archive-notice" data-kind="${key}" role="status">${text}</p>`;
}

export function errorList(errors = {}) {
  const entries = Object.entries(errors);
  if (entries.length === 0) return raw('');
  return html`<ul class="field-errors" role="alert">
    ${entries.map(([, message]) => html`<li>${message}</li>`)}
  </ul>`;
}
