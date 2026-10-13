const $ = (id) => document.getElementById(id);
const currency = (value) => value == null || !Number.isFinite(Number(value)) ? 'Unavailable' : `$${Math.round(Number(value)).toLocaleString('en-US')}`;
const percent = (value) => value == null || !Number.isFinite(Number(value)) ? 'Unavailable' : `${(Number(value) * 100).toFixed(1)}%`;
let activeFilters = { period: 'both', currency: 'all' };

function showNotice(message) { const notice = $('notice'); notice.textContent = message; notice.hidden = false; }
function hideNotice() { $('notice').hidden = true; }

// If the session expires or is missing, send the user back to the login page.
function guardAuth(response) {
  if (response.status === 401) { window.location.assign('/login'); return true; }
  return false;
}

async function signOut() {
  try { await fetch('/api/logout', { method: 'POST' }); } finally { window.location.assign('/login'); }
}

function renderTrend(rows = []) {
  const el = $('trend');
  if (!rows.length) { el.innerHTML = '<p class="panel-sub">No sales detail for this selection.</p>'; el.setAttribute('aria-label', 'No trend data'); return; }
  const width = 720, height = 218, pad = { l: 12, r: 12, t: 14, b: 28 };
  const values = rows.map((r) => Number(r.value_usd) || 0), max = Math.max(...values, 1);
  const x = (i) => pad.l + i * (width - pad.l - pad.r) / Math.max(1, rows.length - 1);
  const y = (v) => pad.t + (height - pad.t - pad.b) * (1 - v / max);
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const ticks = [0, .5, 1].map((fraction) => {
    const yy = y(max * fraction);
    return `<line class="chart-grid" x1="${pad.l}" x2="${width-pad.r}" y1="${yy}" y2="${yy}"/><text x="${pad.l}" y="${yy-4}">$${Math.round(max*fraction/1000)}k</text>`;
  }).join('');
  const labelIdx = [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])];
  const labels = labelIdx.map((i) => `<text text-anchor="${i===0?'start':i===rows.length-1?'end':'middle'}" x="${x(i)}" y="${height-4}">${new Date(`${rows[i].date}T00:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</text>`).join('');
  el.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily covered sales from ${rows[0].date} to ${rows.at(-1).date}"><defs><linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#e8a632" stop-opacity=".2"/><stop offset="1" stop-color="#e8a632" stop-opacity="0"/></linearGradient></defs>${ticks}<polygon class="chart-area" points="${pad.l},${height-pad.b} ${points} ${x(rows.length-1)},${height-pad.b}"/><polyline class="chart-line" points="${points}"/>${labels}</svg>`;
  el.setAttribute('aria-label', `Covered sales trend, ${rows.length} observed days. Highest observed value ${currency(Math.max(...values))}.`);
}

function renderRank(id, rows = [], kind) {
  const el = $(id);
  if (!rows.length) { el.innerHTML = '<p class="panel-sub">No rows for this period.</p>'; return; }
  el.innerHTML = rows.slice(0, 5).map((row, i) => `<div class="rank-row"><span class="rank-index">${String(i+1).padStart(2,'0')}</span><span class="rank-name" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</span><span class="rank-value">${currency(row.value_usd)}</span></div>`).join('');
}

function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function loadOverview() {
  hideNotice();
  try {
    const query = new URLSearchParams(activeFilters);
    const response = await fetch(`/api/overview?${query}`);
    if (guardAuth(response)) return;
    if (!response.ok) throw new Error('Could not load dashboard data.');
    const data = await response.json();
    $('kpi-net').textContent = currency(data.net_document_sales_usd);
    $('kpi-sales').textContent = currency(data.sales_document_financials?.document_value_usd);
    $('kpi-returns').textContent = currency(data.return_document_financials?.document_value_usd);
    $('kpi-margin').textContent = percent(data.sales_profit?.gross_margin);
    renderTrend(data.sales_trend);
    renderRank('customers', data.customer_ranking, 'customer');
    renderRank('items', data.item_ranking, 'item');
    $('refresh-time').textContent = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  } catch (error) { showNotice(error.message); }
}

function addMessage(className, content, html = false) {
  const div = document.createElement('div'); div.className = `chat-message ${className}`;
  if (html) div.innerHTML = content; else div.textContent = content;
  $('conversation').append(div); div.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return div;
}

async function ask(question) {
  const q = question.trim(); if (!q) return;
  addMessage('user', q);
  const loading = addMessage('loading', 'Checking the approved sales and returns measures…');
  const submit = $('ask-form').querySelector('button'); submit.disabled = true;
  try {
    const response = await fetch('/api/ask', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ question:q, filters:activeFilters }) });
    if (guardAuth(response)) { loading.remove(); submit.disabled = false; return; }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not analyze this question.');
    loading.remove();
    const status = result.status === 'blocked' ? 'blocked' : '';
    addMessage('assistant', `<span class="status ${status}">${escapeHtml(result.status || 'qualified')}</span><h3>${escapeHtml(result.title)}</h3>${result.html}<div class="evidence">Period: ${escapeHtml(activeFilters.period)} · SC USD · ${escapeHtml(result.evidence)}</div>`, true);
  } catch (error) { loading.remove(); addMessage('assistant', error.message); }
  finally { submit.disabled = false; }
}

$('period').addEventListener('change', (event) => { activeFilters.period = event.target.value; loadOverview(); });
$('ask-form').addEventListener('submit', (event) => { event.preventDefault(); const input = $('question'); ask(input.value); input.value = ''; });
document.querySelectorAll('[data-question]').forEach((button) => button.addEventListener('click', () => ask(button.dataset.question)));
$('clear-chat').addEventListener('click', () => { $('conversation').replaceChildren(); });
$('signout').addEventListener('click', signOut);
loadOverview();