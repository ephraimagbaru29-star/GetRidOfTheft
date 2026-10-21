/** Format an ISO date string to a readable local datetime */
export function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Show / hide an element */
export function show(el) { el && el.classList.remove('hidden'); }
export function hide(el) { el && el.classList.add('hidden'); }

/** Render an alert div. type = 'error' | 'success' | 'info' | 'warning' */
export function renderAlert(message, type = 'error') {
  const div = document.createElement('div');
  div.className = `alert alert-${type}`;
  div.textContent = message;
  return div;
}

/** Clear all children of an element */
export function clearEl(el) { while (el.firstChild) el.removeChild(el.firstChild); }

/** Build a <dl class="job-detail-grid"> from a plain object */
export function buildDetailGrid(data) {
  const dl = document.createElement('dl');
  dl.className = 'job-detail-grid';
  for (const [key, value] of Object.entries(data)) {
    const dt = document.createElement('dt');
    dt.textContent = key;
    const dd = document.createElement('dd');
    dd.textContent = value ?? '—';
    dl.append(dt, dd);
  }
  return dl;
}

/** Status badge element */
export function statusBadge(status) {
  const span = document.createElement('span');
  span.textContent = status;
  const map = { active: 'badge-active', partial: 'badge-partial', closed: 'badge-closed', in_shop: 'badge-inshop', collected: 'badge-collected' };
  span.className = `badge ${map[status] || ''}`;
  return span;
}

/** Escape HTML for safe insertion */
export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
