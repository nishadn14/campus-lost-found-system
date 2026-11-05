// Campus Lost & Found - single-page frontend (vanilla JS, hash routing)
const $app = document.getElementById('app');
let user = null;
let token = localStorage.getItem('token');
let CATS = [];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = d => new Date(d.replace(' ', 'T') + (d.length > 10 ? 'Z' : '')).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const imgUrl = i => (i.image ? '/uploads/' + encodeURIComponent(i.image) : '/placeholder.svg');
const CAT_ICON = { 'Electronics': '💻', 'Books & Notes': '📚', 'ID / Cards': '🪪', 'Keys': '🔑', 'Clothing': '👕', 'Bags': '🎒', 'Wallets': '👛', 'Accessories': '⌚', 'Other': '📦' };
const media = (it, cls) => it.image
  ? `<div class="${cls}" style="background-image:url('/uploads/${encodeURIComponent(it.image)}')"></div>`
  : `<div class="${cls} noimg">${CAT_ICON[it.category] || '📦'}</div>`;
const go = h => { location.hash = h; };

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = 'alert ' + type; el.textContent = msg;
  document.getElementById('toast').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

async function api(url, { method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  const r = await fetch('/api' + url, { method, headers, body });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function setSession(t, u) { token = t; user = u; localStorage.setItem('token', t); }
function logout(silent) {
  token = null; user = null; localStorage.removeItem('token');
  if (!silent) toast('You have been logged out.');
  go('#/login');
}
window.logout = logout;

function renderNav() {
  const a = (h, t) => `<a href="${h}">${t}</a>`;
  document.getElementById('nav').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;padding:12px 0;width:100%">
      <a class="brand" href="#/">🎒 Campus Lost &amp; Found</a>
      <nav>${a('#/', 'Browse')}${user
        ? a('#/report/lost', 'Report Lost') + a('#/report/found', 'Report Found') + a('#/my', 'My Activity') +
          (user.role === 'admin' ? a('#/admin/items', 'Admin') : '') +
          `<a href="#" onclick="logout();return false">Logout (${esc(user.name)})</a>`
        : a('#/login', 'Login') + '<a class="btn small" href="#/register">Register</a>'}</nav>
    </div>`;
}

const needLogin = () => { if (!user) { toast('Please log in first.', 'error'); go('#/login'); return true; } };

// ---------- Router ----------
async function route() {
  renderNav();
  const [page = '', arg] = location.hash.replace(/^#\/?/, '').split('/');
  $app.innerHTML = '<p class="loading">Loading…</p>';
  window.scrollTo(0, 0);
  try {
    if (page === '') await pageBrowse();
    else if (page === 'item') await pageItem(arg);
    else if (page === 'login') pageLogin();
    else if (page === 'register') pageRegister();
    else if (page === 'report') { if (!needLogin()) pageReport(arg === 'found' ? 'found' : 'lost'); }
    else if (page === 'my') { if (!needLogin()) await pageMy(); }
    else if (page === 'admin') { if (!needLogin()) await pageAdmin(arg || 'items'); }
    else $app.innerHTML = '<div class="alert error">Page not found.</div>';
  } catch (e) { $app.innerHTML = `<div class="alert error">${esc(e.message)}</div>`; }
}

// ---------- Browse ----------
const itemCard = it => `
  <a class="card" href="#/item/${it.id}">
    ${media(it, 'thumb')}
    <div class="card-body">
      <span class="badge ${it.type}">${it.type.toUpperCase()}</span>
      ${it.status === 'returned' ? '<span class="badge returned">RETURNED</span>' : ''}
      <h3>${esc(it.title)}</h3>
      <p class="muted">📍 ${esc(it.location)}<br>📅 ${fmtDate(it.item_date)} · ${esc(it.category)}</p>
    </div></a>`;

async function pageBrowse() {
  $app.innerHTML = `
    <section class="hero"><h1>Lost something? Found something?</h1><p>Report it, search for it, and help items find their way home.</p></section>
    <form class="filters" id="filters">
      <input name="q" placeholder="Search title, description, location…">
      <select name="type"><option value="">Lost &amp; Found</option><option value="lost">Lost</option><option value="found">Found</option></select>
      <select name="category"><option value="">All categories</option>${CATS.map(c => `<option>${esc(c)}</option>`).join('')}</select>
      <select name="status"><option value="open">Open</option><option value="returned">Returned</option><option value="all">All</option></select>
      <button class="btn">Search</button>
    </form>
    <div class="grid" id="grid"></div>`;
  const form = document.getElementById('filters'), grid = document.getElementById('grid');
  const load = async () => {
    const qs = new URLSearchParams(new FormData(form)).toString();
    try {
      const items = await api('/items?' + qs);
      grid.innerHTML = items.map(itemCard).join('') || '<p class="muted">No items match your search.</p>';
    } catch (e) { toast(e.message, 'error'); }
  };
  form.addEventListener('submit', e => { e.preventDefault(); load(); });
  form.querySelectorAll('select').forEach(s => s.addEventListener('change', load));
  load();
}

// ---------- Auth ----------
function pageLogin() {
  $app.innerHTML = `<div class="form-box"><h2>Login</h2><form id="f">
    <label>Email<input type="email" name="email" required></label>
    <label>Password<input type="password" name="password" required></label>
    <button class="btn">Login</button></form>
    <p class="muted">No account? <a href="#/register">Register</a></p></div>`;
  document.getElementById('f').onsubmit = async e => {
    e.preventDefault();
    try {
      const d = await api('/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      setSession(d.token, d.user); toast('Welcome back, ' + d.user.name + '!'); go('#/');
    } catch (err) { toast(err.message, 'error'); }
  };
}
function pageRegister() {
  $app.innerHTML = `<div class="form-box"><h2>Create account</h2><form id="f">
    <label>Full name<input name="name" required></label>
    <label>Email<input type="email" name="email" required></label>
    <label>Password<input type="password" name="password" minlength="6" required></label>
    <label>Confirm password<input type="password" name="confirm" required></label>
    <button class="btn">Register</button></form></div>`;
  document.getElementById('f').onsubmit = async e => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    if (body.password !== body.confirm) return toast('Passwords do not match.', 'error');
    try {
      const d = await api('/register', { method: 'POST', body });
      setSession(d.token, d.user); toast('Account created. Welcome!'); go('#/');
    } catch (err) { toast(err.message, 'error'); }
  };
}

// ---------- Report ----------
function pageReport(type) {
  const today = new Date().toISOString().slice(0, 10);
  $app.innerHTML = `<div class="form-box wide"><h2>Report a ${type} item</h2><form id="f" enctype="multipart/form-data">
    <input type="hidden" name="type" value="${type}">
    <label>Item name<input name="title" maxlength="150" required></label>
    <label>Category<select name="category">${CATS.map(c => `<option>${esc(c)}</option>`).join('')}</select></label>
    <label>Description (colour, brand, marks…)<textarea name="description" rows="4" required></textarea></label>
    <label>Location ${type === 'lost' ? 'last seen' : 'found'}<input name="location" required></label>
    <label>Date ${type}<input type="date" name="item_date" max="${today}" value="${today}" required></label>
    <label>Contact (phone / email)<input name="contact" value="${esc(user.email)}" required></label>
    <label>Photo (optional, max 2 MB)<input type="file" name="image" accept="image/*"></label>
    <button class="btn">Submit report</button></form></div>`;
  document.getElementById('f').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (!fd.get('image') || !fd.get('image').name) fd.delete('image');
    try { const d = await api('/items', { method: 'POST', body: fd }); toast('Your report has been posted.'); go('#/item/' + d.id); }
    catch (err) { toast(err.message, 'error'); }
  };
}

// ---------- Item detail ----------
async function pageItem(id) {
  const { item: it, isOwner, myClaim, claims } = await api('/items/' + encodeURIComponent(id));
  const canRequest = it.status === 'open' && (!user || user.id !== it.user_id);
  $app.innerHTML = `
    <div class="detail">
      ${media(it, 'detail-img')}
      <div>
        <span class="badge ${it.type}">${it.type.toUpperCase()}</span> <span class="badge ${it.status === 'open' ? 'open' : 'returned'}">${it.status.toUpperCase()}</span>
        <h1>${esc(it.title)}</h1>
        <p>${esc(it.description).replace(/\n/g, '<br>')}</p>
        <table class="meta">
          <tr><th>Category</th><td>${esc(it.category)}</td></tr>
          <tr><th>Location</th><td>${esc(it.location)}</td></tr>
          <tr><th>Date</th><td>${fmtDate(it.item_date)}</td></tr>
          <tr><th>Posted by</th><td>${esc(it.poster)} on ${fmtDate(it.created_at)}</td></tr>
          <tr><th>Contact</th><td>${user ? esc(it.contact) : '<em>Log in to view</em>'}</td></tr>
        </table>
        ${isOwner ? `<div class="inline">
          <button class="btn" id="toggle">${it.status === 'open' ? 'Mark as returned' : 'Re-open'}</button>
          <button class="btn danger" id="del">Delete</button></div>` : ''}
      </div>
    </div>
    ${canRequest ? `<div class="panel"><h3>${it.type === 'found' ? 'Is this yours? Claim it' : 'Did you find this? Let the owner know'}</h3>
      ${!user ? '<p><a href="#/login">Log in</a> to send a request.</p>'
        : myClaim ? `<p>You already sent a request (status: <span class="badge ${myClaim.status}">${myClaim.status.toUpperCase()}</span>).</p>`
        : `<form id="claim"><label>${it.type === 'found' ? 'Describe identifying details only the owner would know' : 'Where and when did you find it?'}
           <textarea name="message" rows="3" required></textarea></label><button class="btn">Send request</button></form>`}
      </div>` : ''}
    ${isOwner ? `<div class="panel"><h3>Requests (${claims.length})</h3>
      ${claims.map(c => `<div class="claim"><strong>${esc(c.name)}</strong> <span class="muted">(${esc(c.email)}) · ${fmtDate(c.created_at)}</span>
        <span class="badge ${c.status}">${c.status.toUpperCase()}</span><p>${esc(c.message).replace(/\n/g, '<br>')}</p>
        ${c.status === 'pending' ? `<button class="btn small" data-act="approve" data-id="${c.id}">Approve</button>
        <button class="btn small danger" data-act="reject" data-id="${c.id}">Reject</button>` : ''}</div>`).join('') || '<p class="muted">No requests yet.</p>'}
      </div>` : ''}`;

  const run = async (fn, msg, after) => { try { await fn(); toast(msg); after ? after() : route(); } catch (e) { toast(e.message, 'error'); } };
  const t = document.getElementById('toggle'), d = document.getElementById('del'), c = document.getElementById('claim');
  if (t) t.onclick = () => run(() => api(`/items/${it.id}/toggle`, { method: 'POST' }), 'Status updated.');
  if (d) d.onclick = () => confirm('Delete this item?') && run(() => api('/items/' + it.id, { method: 'DELETE' }), 'Item deleted.', () => go('#/'));
  if (c) c.onsubmit = e => { e.preventDefault(); run(() => api(`/items/${it.id}/claims`, { method: 'POST', body: Object.fromEntries(new FormData(c)) }), 'Request sent to the poster.'); };
  $app.querySelectorAll('[data-act]').forEach(b => b.onclick = () =>
    run(() => api(`/claims/${b.dataset.id}/${b.dataset.act}`, { method: 'POST' }), 'Request ' + b.dataset.act + 'd.'));
}

// ---------- My activity ----------
async function pageMy() {
  const { items, claims } = await api('/my');
  $app.innerHTML = `<h2>My reports</h2>
    <table class="table"><tr><th>Item</th><th>Type</th><th>Status</th><th>Pending requests</th><th></th></tr>
    ${items.map(i => `<tr><td>${esc(i.title)}</td><td><span class="badge ${i.type}">${i.type}</span></td><td>${i.status}</td><td>${i.pending}</td>
      <td><a href="#/item/${i.id}">Manage</a></td></tr>`).join('') || '<tr><td colspan="5" class="muted">You have not reported anything yet.</td></tr>'}</table>
    <h2>My requests</h2>
    <table class="table"><tr><th>Item</th><th>My message</th><th>Status</th></tr>
    ${claims.map(c => `<tr><td><a href="#/item/${c.item_id}">${esc(c.title)}</a></td><td>${esc(c.message)}</td>
      <td><span class="badge ${c.status}">${c.status}</span></td></tr>`).join('') || '<tr><td colspan="3" class="muted">No requests submitted.</td></tr>'}</table>`;
}

// ---------- Admin ----------
async function pageAdmin(tab) {
  if (user.role !== 'admin') { $app.innerHTML = '<div class="alert error">Access denied.</div>'; return; }
  const [s, rows] = await Promise.all([api('/admin/stats'), api('/admin/' + (['items', 'users', 'claims'].includes(tab) ? tab : 'items'))]);
  const tabLink = (k, t) => `<a href="#/admin/${k}" class="${tab === k ? 'on' : ''}">${t}</a>`;
  let table;
  if (tab === 'users') table = `<tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr>` + rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.email)}</td><td>${r.role}</td>
    <td><button class="btn small" data-a="role" data-id="${r.id}">Toggle admin</button> <button class="btn small danger" data-a="deluser" data-id="${r.id}">Delete</button></td></tr>`).join('');
  else if (tab === 'claims') table = `<tr><th>Item</th><th>From</th><th>Message</th><th>Status</th></tr>` + rows.map(r => `<tr><td><a href="#/item/${r.item_id}">${esc(r.title)}</a></td>
    <td>${esc(r.name)}</td><td>${esc(r.message)}</td><td><span class="badge ${r.status}">${r.status}</span></td></tr>`).join('');
  else table = `<tr><th>Item</th><th>Type</th><th>Status</th><th>Posted by</th><th></th></tr>` + rows.map(r => `<tr><td><a href="#/item/${r.id}">${esc(r.title)}</a></td>
    <td><span class="badge ${r.type}">${r.type}</span></td><td>${r.status}</td><td>${esc(r.poster)}</td>
    <td><button class="btn small danger" data-a="delitem" data-id="${r.id}">Delete</button></td></tr>`).join('');
  $app.innerHTML = `<h2>Admin dashboard</h2>
    <div class="stats"><div><b>${s.items}</b>Total items</div><div><b>${s.returned}</b>Returned</div><div><b>${s.users}</b>Users</div><div><b>${s.pending}</b>Pending requests</div></div>
    <p class="tabs">${tabLink('items', 'Items')}${tabLink('users', 'Users')}${tabLink('claims', 'Requests')}</p>
    <table class="table">${table}</table>`;
  const actions = {
    role: id => api(`/admin/users/${id}/role`, { method: 'POST' }),
    deluser: id => confirm('Delete user and all their data?') && api('/admin/users/' + id, { method: 'DELETE' }),
    delitem: id => confirm('Delete item?') && api('/items/' + id, { method: 'DELETE' }),
  };
  $app.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
    try { const r = await actions[b.dataset.a](b.dataset.id); if (r) { toast('Done.'); route(); } } catch (e) { toast(e.message, 'error'); }
  });
}

// ---------- Init ----------
(async function init() {
  document.getElementById('yr').textContent = new Date().getFullYear();
  try { CATS = await api('/categories'); } catch {}
  if (token) { try { user = (await api('/me')).user; } catch { token = null; localStorage.removeItem('token'); } }
  window.addEventListener('hashchange', route);
  route();
})();
