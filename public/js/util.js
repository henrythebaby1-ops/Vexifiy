export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export const api = async (path, opts) => {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
};

export const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(`vexifiy.${key}`); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`vexifiy.${key}`, JSON.stringify(value)); } catch { /* private window */ }
  },
};

export const compareVersions = (a, b) => {
  const [ax, ay] = String(a ?? '0.0').split('.').map(Number);
  const [bx, by] = String(b ?? '0.0').split('.').map(Number);
  return ax - bx || ay - by;
};

const RULE = /(?:RSC|SC|SG|GG|S|G|R|T)\d{1,2}/;

// Turns rule tags into links. Works on text that has already been escaped.
export function linkRules(html, known) {
  return html.replace(new RegExp(`&lt;(${RULE.source})&gt;|\\b(${RULE.source})\\b`, 'g'), (m, a, b) => {
    const rule = a || b;
    if (b && !known?.all?.has(rule)) return m;
    const backed = !known?.cited || known.cited.has(rule);
    const title = backed ? `Open ${rule}` : `${rule} was not in the excerpts the AI was given. Check it yourself.`;
    return `<a class="chip${backed ? '' : ' unverified'}" href="#/rules/${rule}" title="${title}">${rule}${backed ? '' : ' ?'}</a>`;
  });
}

// Small, safe Markdown subset for AI answers.
export function renderAnswer(text, known) {
  const safe = esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const blocks = safe.split(/\n{2,}/).map((block) => {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l))) {
      return `<ul>${lines.map((l) => `<li>${l.replace(/^\s*([-*•]|\d+\.)\s+/, '')}</li>`).join('')}</ul>`;
    }
    return `<p>${lines.join('<br>')}</p>`;
  });
  return linkRules(blocks.join(''), known);
}
