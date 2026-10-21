/**
 * Phone Charging Tracking System — main frontend app (vanilla JS, ES modules)
 */

import * as API   from './api.js';
import * as Utils from './utils.js';
import { FaceCapture } from './face.js';

// ── State ─────────────────────────────────────────────────────────
let currentStaff = null;

// ── Boot ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const token = sessionStorage.getItem('ct_token');
  if (token) {
    try {
      const { user } = await API.getMe();
      currentStaff = user;
      showApp();
      showScreen('dashboard');
    } catch {
      sessionStorage.removeItem('ct_token');
      showLoginScreen();
    }
  } else {
    showLoginScreen();
  }
});

// ── Login ─────────────────────────────────────────────────────────
function showLoginScreen() {
  Utils.hide(document.getElementById('app'));
  Utils.show(document.getElementById('login-screen'));

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('login-error');
    Utils.hide(errEl);
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    try {
      const { token, user } = await API.login(username, password);
      sessionStorage.setItem('ct_token', token);
      currentStaff = user;
      Utils.hide(document.getElementById('login-screen'));
      showApp();
      showScreen('dashboard');
    } catch (err) {
      errEl.textContent = err.message;
      Utils.show(errEl);
    }
  });
}

function showApp() {
  Utils.show(document.getElementById('app'));
  document.getElementById('staff-display').textContent =
    `${currentStaff.display_name} (${currentStaff.role})`;

  // Nav buttons
  document.getElementById('nav-dashboard').addEventListener('click', () => showScreen('dashboard'));
  document.getElementById('nav-intake').addEventListener('click',    () => showScreen('intake'));
  document.getElementById('nav-search').addEventListener('click',    () => showScreen('search'));
  document.getElementById('nav-history').addEventListener('click',   () => showScreen('history'));
  document.getElementById('nav-logout').addEventListener('click',    logout);
}

function logout() {
  sessionStorage.removeItem('ct_token');
  currentStaff = null;
  Utils.hide(document.getElementById('app'));
  showLoginScreen();
}

// ── Screen router ─────────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => Utils.hide(s));
  document.querySelectorAll('#nav-links button[data-screen]').forEach(b => {
    b.classList.toggle('active', b.dataset.screen === name);
  });
  const el = document.getElementById(`screen-${name}`);
  if (el) Utils.show(el);

  switch (name) {
    case 'dashboard': renderDashboard(); break;
    case 'intake':    renderIntake();    break;
    case 'search':    renderSearch();    break;
    case 'history':   renderHistory();   break;
  }
}

// ── Dashboard ─────────────────────────────────────────────────────
async function renderDashboard() {
  const el = document.getElementById('screen-dashboard');
  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-value" id="stat-active">…</div><div class="stat-label">Active Jobs</div></div>
      <div class="stat-card"><div class="stat-value" id="stat-partial">…</div><div class="stat-label">Partially Collected</div></div>
      <div class="stat-card"><div class="stat-value" id="stat-devices">…</div><div class="stat-label">Devices In Shop</div></div>
      <div class="stat-card"><div class="stat-value" id="stat-closed">…</div><div class="stat-label">Closed Today</div></div>
    </div>
    <div class="quick-actions">
      <button class="btn btn-primary" onclick="app.showScreen('intake')">＋ New Intake</button>
      <button class="btn btn-secondary" onclick="app.showScreen('search')">🔍 Search Number</button>
      <button class="btn btn-secondary" onclick="app.showScreen('history')">📋 History</button>
    </div>
    <div class="card">
      <h2>Active &amp; Partial Jobs</h2>
      <div id="dash-jobs-list"><p style="color:var(--neutral-400);font-size:.9rem">Loading…</p></div>
    </div>
  `;

  try {
    const [{ stats }, { jobs }] = await Promise.all([
      API.getStats(),
      API.listJobs({ status: 'active' }),
    ]);
    const partialJobs = (await API.listJobs({ status: 'partial' })).jobs;
    const allActive = [...jobs, ...partialJobs];

    document.getElementById('stat-active').textContent  = stats.active_jobs;
    document.getElementById('stat-partial').textContent = stats.partial_jobs;
    document.getElementById('stat-devices').textContent = stats.devices_in_shop;
    document.getElementById('stat-closed').textContent  = stats.closed_jobs;

    const listEl = document.getElementById('dash-jobs-list');
    if (!allActive.length) {
      listEl.innerHTML = '<p style="color:var(--neutral-400);font-size:.9rem">No active jobs.</p>';
      return;
    }
    listEl.innerHTML = allActive.map(j => `
      <div class="collect-device-row" style="margin-bottom:.5rem;cursor:pointer"
           onclick="app.openJob('${j.id}')">
        <div class="collect-device-info">
          <strong>${Utils.esc(j.charging_number)}</strong> — ${Utils.esc(j.customer_name)}
          <span style="margin-left:.5rem">${Utils.statusBadge(j.status).outerHTML}</span>
        </div>
        <div style="font-size:.8rem;color:var(--neutral-400)">
          ${j.devices_in_shop} device(s) in shop · ${Utils.fmtDateTime(j.created_at)}
        </div>
      </div>
    `).join('');
  } catch (err) {
    document.getElementById('dash-jobs-list').innerHTML =
      `<p class="alert alert-error">${Utils.esc(err.message)}</p>`;
  }
}

// ── Intake ────────────────────────────────────────────────────────
let faceCapture    = null;
let capturedBlob   = null;
let capturedDataURL = null;
let deviceCount    = 0;

function renderIntake() {
  const el = document.getElementById('screen-intake');
  el.innerHTML = `
    <div class="card">
      <h2>New Intake / Registration</h2>
      <div id="intake-alert"></div>

      <div class="form-row">
        <div class="form-group">
          <label for="in-number">Charging Card Number *</label>
          <input id="in-number" type="text" placeholder="e.g. CH-014" autocomplete="off" />
        </div>
        <div class="form-group">
          <label for="in-name">Customer Name *</label>
          <input id="in-name" type="text" placeholder="Full name" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="in-contact">Contact (optional)</label>
          <input id="in-contact" type="text" placeholder="Phone / email" />
        </div>
        <div class="form-group">
          <label for="in-notes">Notes (optional)</label>
          <input id="in-notes" type="text" placeholder="Any extra notes" />
        </div>
      </div>
    </div>

    <!-- Face capture -->
    <div class="card">
      <h2>Face Capture (optional)</h2>
      <div class="consent-box">
        <label>
          <input type="checkbox" id="face-consent" />
          <span>The customer has been informed that their face photo will be taken for identity verification purposes and has given their consent.</span>
        </label>
      </div>
      <div id="face-capture-area" class="hidden"></div>
      <div id="face-saved-preview" class="hidden" style="text-align:center">
        <img id="face-saved-img" src="" alt="Captured face" style="max-width:180px;border-radius:8px;border:2px solid #e2e8f0" />
        <p style="font-size:.8rem;color:var(--neutral-600);margin-top:.4rem">Face photo ready — will be saved with registration.</p>
      </div>
    </div>

    <!-- Devices -->
    <div class="card">
      <h2>Devices</h2>
      <div id="device-list" class="device-list"></div>
      <button class="btn btn-secondary" id="add-device-btn" style="margin-top:.75rem">＋ Add Another Device</button>
    </div>

    <div style="display:flex;gap:.75rem;flex-wrap:wrap">
      <button class="btn btn-primary" id="save-intake-btn">💾 Save Registration</button>
      <button class="btn btn-secondary" onclick="app.showScreen('dashboard')">Cancel</button>
    </div>
    <div id="receipt-area" class="hidden" style="margin-top:1rem"></div>
  `;

  deviceCount = 0;
  capturedBlob = null;
  capturedDataURL = null;
  addDeviceRow();

  // Consent checkbox controls camera
  document.getElementById('face-consent').addEventListener('change', (e) => {
    const area = document.getElementById('face-capture-area');
    if (e.target.checked) {
      Utils.show(area);
      startFaceCapture(area);
    } else {
      Utils.hide(area);
      stopFaceCapture();
      capturedBlob = null;
      capturedDataURL = null;
      Utils.hide(document.getElementById('face-saved-preview'));
    }
  });

  document.getElementById('add-device-btn').addEventListener('click', () => addDeviceRow());
  document.getElementById('save-intake-btn').addEventListener('click', () => saveIntake());
}

function startFaceCapture(area) {
  if (faceCapture) faceCapture.stop();
  faceCapture = new FaceCapture(area, (blob, dataURL) => {
    capturedBlob   = blob;
    capturedDataURL = dataURL;
    const preview = document.getElementById('face-saved-preview');
    if (blob) {
      document.getElementById('face-saved-img').src = dataURL;
      Utils.show(preview);
    } else {
      Utils.hide(preview);
    }
  });
  faceCapture.start();
}

function stopFaceCapture() {
  if (faceCapture) { faceCapture.stop(); faceCapture = null; }
}

function addDeviceRow() {
  deviceCount++;
  const n = deviceCount;
  const listEl = document.getElementById('device-list');
  const row = document.createElement('div');
  row.className = 'device-row';
  row.dataset.deviceIndex = n;
  row.innerHTML = `
    <div class="device-row-header">
      <span>Device ${n}</span>
      ${n > 1 ? `<button class="btn btn-danger btn-sm" onclick="this.closest('.device-row').remove()">Remove</button>` : ''}
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Device Type *</label>
        <select class="dev-type">
          <option value="">— Select —</option>
          <option>Phone</option><option>Tablet</option><option>Laptop</option>
          <option>Smartwatch</option><option>Earbuds</option><option>Other</option>
        </select>
      </div>
      <div class="form-group">
        <label>Brand / Model *</label>
        <input class="dev-brand" type="text" placeholder="e.g. Samsung Galaxy A54" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Colour *</label>
        <input class="dev-colour" type="text" placeholder="e.g. Black" />
      </div>
      <div class="form-group">
        <label>Serial / IMEI (optional)</label>
        <input class="dev-id" type="text" placeholder="Optional identifier" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Condition / Notes</label>
        <input class="dev-condition" type="text" placeholder="e.g. cracked screen, no case" />
      </div>
      <div class="form-group">
        <label>Accessories</label>
        <input class="dev-accessories" type="text" placeholder="e.g. charger, cable" />
      </div>
    </div>
  `;
  listEl.appendChild(row);
}

function collectDeviceRows() {
  const rows = document.querySelectorAll('#device-list .device-row');
  const devices = [];
  for (const row of rows) {
    devices.push({
      device_type:         row.querySelector('.dev-type').value,
      brand_model:         row.querySelector('.dev-brand').value.trim(),
      colour:              row.querySelector('.dev-colour').value.trim(),
      identifier_optional: row.querySelector('.dev-id').value.trim() || null,
      condition_notes:     row.querySelector('.dev-condition').value.trim() || null,
      accessories:         row.querySelector('.dev-accessories').value.trim() || null,
    });
  }
  return devices;
}

async function saveIntake() {
  const alertEl = document.getElementById('intake-alert');
  Utils.clearEl(alertEl);

  const charging_number   = document.getElementById('in-number').value.trim().toUpperCase();
  const customer_name     = document.getElementById('in-name').value.trim();
  const contact_optional  = document.getElementById('in-contact').value.trim();
  const notes             = document.getElementById('in-notes').value.trim();
  const devices           = collectDeviceRows();

  // Validate
  if (!charging_number) return alertEl.append(Utils.renderAlert('Charging card number is required.'));
  if (!customer_name)   return alertEl.append(Utils.renderAlert('Customer name is required.'));
  for (const d of devices) {
    if (!d.device_type)  return alertEl.append(Utils.renderAlert('Select a device type for every device.'));
    if (!d.brand_model)  return alertEl.append(Utils.renderAlert('Brand/model is required for every device.'));
    if (!d.colour)       return alertEl.append(Utils.renderAlert('Colour is required for every device.'));
  }

  const btn = document.getElementById('save-intake-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const { job } = await API.createJob({ charging_number, customer_name, contact_optional, notes, devices });

    // Upload face image if captured
    if (capturedBlob) {
      try {
        const { path } = await API.uploadFaceImage(capturedBlob);
        await API.updateJobFace(job.id, path, new Date().toISOString());
        job.face_image_path = path;
      } catch (faceErr) {
        alertEl.append(Utils.renderAlert(
          `Registration saved, but face upload failed: ${faceErr.message}`, 'warning'
        ));
      }
    }

    stopFaceCapture();
    showReceipt(job);
    alertEl.append(Utils.renderAlert('Registration saved successfully!', 'success'));
  } catch (err) {
    if (err.status === 409 && err.body?.existing_job) {
      const existing = err.body.existing_job;
      alertEl.append(Utils.renderAlert(
        `⚠ This number already has an active job (${existing.status}) for "${existing.customer_name}". ` +
        `Opening that record now…`, 'warning'
      ));
      setTimeout(() => openJob(existing.id), 1800);
    } else {
      alertEl.append(Utils.renderAlert(err.message));
    }
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Save Registration';
  }
}

function showReceipt(job) {
  const receiptArea = document.getElementById('receipt-area');
  Utils.show(receiptArea);
  receiptArea.innerHTML = `
    <div class="card" id="receipt-card">
      <h2>Receipt</h2>
      <dl class="job-detail-grid">
        <dt>Charging Number</dt><dd><strong>${Utils.esc(job.charging_number)}</strong></dd>
        <dt>Customer</dt><dd>${Utils.esc(job.customer_name)}</dd>
        <dt>Registered</dt><dd>${Utils.fmtDateTime(job.created_at)}</dd>
        <dt>Devices</dt><dd>${job.devices.length}</dd>
      </dl>
      <ul style="margin:.5rem 0 1rem 1.2rem;font-size:.88rem">
        ${job.devices.map(d => `<li>${Utils.esc(d.device_type)} — ${Utils.esc(d.brand_model)} (${Utils.esc(d.colour)})</li>`).join('')}
      </ul>
      <p style="font-size:.8rem;color:var(--neutral-600)">Please keep this ticket. You will need the charging number to collect your device(s).</p>
      <button class="btn btn-secondary btn-sm no-print" onclick="window.print()">🖨 Print Receipt</button>
    </div>
  `;
}

// ── Search & Collection ───────────────────────────────────────────
function renderSearch() {
  const el = document.getElementById('screen-search');
  el.innerHTML = `
    <div class="card">
      <h2>Search Charging Number</h2>
      <div class="search-bar">
        <input id="search-input" type="text" placeholder="Enter charging number e.g. CH-014" autocomplete="off" />
        <button class="btn btn-primary" id="search-btn">Search</button>
      </div>
      <div id="search-alert"></div>
    </div>
    <div id="search-result"></div>
  `;

  const input  = document.getElementById('search-input');
  const btn    = document.getElementById('search-btn');

  const doSearch = () => performSearch(input.value.trim().toUpperCase());
  btn.addEventListener('click', doSearch);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
}

async function performSearch(number) {
  const alertEl  = document.getElementById('search-alert');
  const resultEl = document.getElementById('search-result');
  Utils.clearEl(alertEl);
  Utils.clearEl(resultEl);

  if (!number) {
    return alertEl.append(Utils.renderAlert('Enter a charging number to search.', 'info'));
  }

  try {
    const { job } = await API.searchJob(number);
    renderJobDetail(job, resultEl);
  } catch (err) {
    if (err.status === 404) {
      alertEl.append(Utils.renderAlert('No active job found for that charging number.', 'info'));
    } else {
      alertEl.append(Utils.renderAlert(err.message));
    }
  }
}

function renderJobDetail(job, container) {
  Utils.clearEl(container);

  // Job header
  const header = document.createElement('div');
  header.className = 'card';
  header.innerHTML = `
    <h2>
      Job: ${Utils.esc(job.charging_number)}
      <span style="margin-left:.5rem">${Utils.statusBadge(job.status).outerHTML}</span>
    </h2>
    <dl class="job-detail-grid">
      <dt>Customer</dt><dd>${Utils.esc(job.customer_name)}</dd>
      <dt>Contact</dt><dd>${Utils.esc(job.contact_optional) || '—'}</dd>
      <dt>Registered</dt><dd>${Utils.fmtDateTime(job.created_at)}</dd>
      <dt>Registered By</dt><dd>${Utils.esc(job.created_by_name) || '—'}</dd>
      ${job.closed_at ? `<dt>Closed</dt><dd>${Utils.fmtDateTime(job.closed_at)}</dd>` : ''}
      ${job.notes ? `<dt>Notes</dt><dd>${Utils.esc(job.notes)}</dd>` : ''}
      <dt>Face Photo</dt><dd id="face-status-cell">${job.face_image_path ? '✅ Captured' : '❌ Not captured'}</dd>
    </dl>
    ${job.face_image_path ? `
      <div style="margin-top:.5rem">
        <img src="/${Utils.esc(job.face_image_path)}" alt="Customer face"
             style="max-width:120px;border-radius:8px;border:2px solid #e2e8f0;cursor:pointer"
             onclick="this.style.maxWidth = this.style.maxWidth==='120px'?'320px':'120px'" />
        <p style="font-size:.75rem;color:var(--neutral-400);margin-top:.25rem">Click to enlarge</p>
      </div>
    ` : ''}
  `;
  container.appendChild(header);

  // Collection actions (only when job is not closed)
  if (job.status !== 'closed') {
    const actCard = document.createElement('div');
    actCard.className = 'card';
    actCard.innerHTML = `
      <h2>Collection</h2>
      <div id="collect-alert"></div>
      <div style="display:flex;gap:.75rem;flex-wrap:wrap;margin-bottom:1rem">
        <button class="btn btn-success" id="collect-all-btn">✅ Collect All Devices Now</button>
        <button class="btn btn-secondary" id="add-device-here-btn">＋ Add Device to This Job</button>
      </div>
      <p style="font-size:.85rem;color:var(--neutral-600)">Or collect individual devices below:</p>
    `;
    container.appendChild(actCard);

    actCard.querySelector('#collect-all-btn').addEventListener('click', async () => {
      if (!confirm('Mark ALL remaining devices as collected and close this job?')) return;
      try {
        await API.collectAll(job.id);
        const { job: updated } = await API.getJob(job.id);
        renderJobDetail(updated, container);
      } catch (err) {
        document.getElementById('collect-alert')?.append(Utils.renderAlert(err.message));
      }
    });

    actCard.querySelector('#add-device-here-btn').addEventListener('click', () => {
      renderAddDeviceForm(job, container);
    });
  }

  // Device list
  const devCard = document.createElement('div');
  devCard.className = 'card';
  devCard.innerHTML = `<h2>Devices (${job.devices.length})</h2>`;
  const devList = document.createElement('div');
  devList.style.display = 'flex';
  devList.style.flexDirection = 'column';
  devList.style.gap = '.5rem';

  for (const dev of job.devices) {
    const row = document.createElement('div');
    row.className = `collect-device-row${dev.status === 'collected' ? ' collected' : ''}`;
    row.innerHTML = `
      <div class="collect-device-info">
        <strong>${Utils.esc(dev.device_type)} — ${Utils.esc(dev.brand_model)}</strong>
        ${Utils.esc(dev.colour)}
        ${dev.identifier_optional ? ` · <span style="font-size:.8rem;color:var(--neutral-400)">${Utils.esc(dev.identifier_optional)}</span>` : ''}
        ${dev.condition_notes ? `<br><span style="font-size:.8rem;color:var(--neutral-600)">${Utils.esc(dev.condition_notes)}</span>` : ''}
        ${dev.accessories ? `<br><span style="font-size:.8rem;color:var(--neutral-400)">Accessories: ${Utils.esc(dev.accessories)}</span>` : ''}
        ${dev.status === 'collected' ? `<br><span style="font-size:.78rem;color:var(--success)">Collected ${Utils.fmtDateTime(dev.collected_at)} by ${Utils.esc(dev.collected_by_name)}</span>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.3rem">
        ${Utils.statusBadge(dev.status).outerHTML}
        ${dev.status === 'in_shop' && job.status !== 'closed'
          ? `<button class="btn btn-success btn-sm" data-device-id="${dev.id}">Collect</button>`
          : ''}
      </div>
    `;
    const collectBtn = row.querySelector('[data-device-id]');
    if (collectBtn) {
      collectBtn.addEventListener('click', async () => {
        if (!confirm('Mark this device as collected?')) return;
        try {
          await API.collectDevice(job.id, dev.id);
          const { job: updated } = await API.getJob(job.id);
          renderJobDetail(updated, container);
        } catch (err) {
          alert(`Error: ${err.message}`);
        }
      });
    }
    devList.appendChild(row);
  }
  devCard.appendChild(devList);
  container.appendChild(devCard);

  // Audit log (collapsible)
  if (job.audit && job.audit.length) {
    const auditCard = document.createElement('div');
    auditCard.className = 'card';
    auditCard.innerHTML = `
      <h2 style="cursor:pointer" onclick="this.nextElementSibling.classList.toggle('hidden')">
        📋 Audit History (${job.audit.length}) ▾
      </h2>
      <div class="audit-log hidden">
        ${job.audit.map(a => `
          <div class="audit-entry">
            <span class="audit-time">${Utils.fmtDateTime(a.event_time)}</span>
            <span class="audit-body"><strong>${Utils.esc(a.event_type)}</strong>
              ${a.staff_name ? `by ${Utils.esc(a.staff_name)}` : ''}
              ${a.notes ? ` — ${Utils.esc(a.notes)}` : ''}
            </span>
          </div>
        `).join('')}
      </div>
    `;
    container.appendChild(auditCard);
  }
}

// ── Add device to existing job ────────────────────────────────────
function renderAddDeviceForm(job, container) {
  // Remove any existing add-form
  const existing = document.getElementById('add-device-form-card');
  if (existing) existing.remove();

  const card = document.createElement('div');
  card.className = 'card';
  card.id = 'add-device-form-card';
  card.innerHTML = `
    <h2>Add Device to Job ${Utils.esc(job.charging_number)}</h2>
    <div id="add-device-alert"></div>
    <div class="form-row">
      <div class="form-group">
        <label>Device Type *</label>
        <select id="add-dev-type">
          <option value="">— Select —</option>
          <option>Phone</option><option>Tablet</option><option>Laptop</option>
          <option>Smartwatch</option><option>Earbuds</option><option>Other</option>
        </select>
      </div>
      <div class="form-group">
        <label>Brand / Model *</label>
        <input id="add-dev-brand" type="text" placeholder="e.g. iPhone 14" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Colour *</label>
        <input id="add-dev-colour" type="text" placeholder="e.g. White" />
      </div>
      <div class="form-group">
        <label>Serial / IMEI (optional)</label>
        <input id="add-dev-id" type="text" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Condition / Notes</label>
        <input id="add-dev-condition" type="text" />
      </div>
      <div class="form-group">
        <label>Accessories</label>
        <input id="add-dev-accessories" type="text" />
      </div>
    </div>
    <div class="form-group">
      <label>Reason for adding</label>
      <input id="add-dev-reason" type="text" placeholder="e.g. customer came back with a second phone" />
    </div>
    <div style="display:flex;gap:.75rem">
      <button class="btn btn-primary" id="submit-add-device">＋ Add Device</button>
      <button class="btn btn-secondary" id="cancel-add-device">Cancel</button>
    </div>
  `;
  container.appendChild(card);
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });

  card.querySelector('#cancel-add-device').addEventListener('click', () => card.remove());
  card.querySelector('#submit-add-device').addEventListener('click', async () => {
    const alertEl = document.getElementById('add-device-alert');
    Utils.clearEl(alertEl);
    const data = {
      device_type:         document.getElementById('add-dev-type').value,
      brand_model:         document.getElementById('add-dev-brand').value.trim(),
      colour:              document.getElementById('add-dev-colour').value.trim(),
      identifier_optional: document.getElementById('add-dev-id').value.trim() || null,
      condition_notes:     document.getElementById('add-dev-condition').value.trim() || null,
      accessories:         document.getElementById('add-dev-accessories').value.trim() || null,
      reason:              document.getElementById('add-dev-reason').value.trim() || null,
    };
    if (!data.device_type) return alertEl.append(Utils.renderAlert('Device type is required.'));
    if (!data.brand_model) return alertEl.append(Utils.renderAlert('Brand/model is required.'));
    if (!data.colour)      return alertEl.append(Utils.renderAlert('Colour is required.'));

    try {
      await API.addDeviceToJob(job.id, data);
      card.remove();
      const { job: updated } = await API.getJob(job.id);
      renderJobDetail(updated, container);
    } catch (err) {
      alertEl.append(Utils.renderAlert(err.message));
    }
  });
}

// ── History ───────────────────────────────────────────────────────
async function renderHistory() {
  const el = document.getElementById('screen-history');
  el.innerHTML = `
    <div class="card">
      <h2>Job History</h2>
      <div class="search-bar" style="margin-bottom:.75rem">
        <input id="history-search" type="text" placeholder="Search name or number…" />
        <select id="history-filter" style="padding:.5rem .75rem;border:1.5px solid var(--neutral-200);border-radius:8px;font-size:.9rem">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="partial">Partial</option>
          <option value="closed">Closed</option>
        </select>
        <button class="btn btn-primary" id="history-search-btn">Search</button>
      </div>
      <div id="history-alert"></div>
    </div>
    <div id="history-list"></div>
  `;

  const doSearch = () => loadHistory();
  document.getElementById('history-search-btn').addEventListener('click', doSearch);
  document.getElementById('history-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
  loadHistory();
}

async function loadHistory() {
  const alertEl  = document.getElementById('history-alert');
  const listEl   = document.getElementById('history-list');
  Utils.clearEl(alertEl);
  Utils.clearEl(listEl);

  const search = document.getElementById('history-search')?.value.trim();
  const status = document.getElementById('history-filter')?.value;
  const params = {};
  if (search) params.search = search;
  if (status) params.status = status;

  try {
    const { jobs } = await API.listJobs(params);
    if (!jobs.length) {
      alertEl.append(Utils.renderAlert('No jobs found.', 'info'));
      return;
    }
    listEl.innerHTML = jobs.map(j => `
      <div class="card" style="padding:1rem;cursor:pointer;margin-bottom:.75rem" onclick="app.openJob('${j.id}')">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem">
          <div>
            <strong style="font-size:1rem">${Utils.esc(j.charging_number)}</strong>
            <span style="margin-left:.5rem">${Utils.statusBadge(j.status).outerHTML}</span>
            <span style="margin-left:.5rem;font-size:.88rem">${Utils.esc(j.customer_name)}</span>
          </div>
          <div style="font-size:.8rem;color:var(--neutral-400)">${Utils.fmtDateTime(j.created_at)}</div>
        </div>
        <div style="font-size:.82rem;color:var(--neutral-600);margin-top:.25rem">
          ${j.total_devices} device(s) · ${j.devices_in_shop} in shop · Staff: ${Utils.esc(j.created_by_name) || '—'}
        </div>
      </div>
    `).join('');
  } catch (err) {
    alertEl.append(Utils.renderAlert(err.message));
  }
}

// ── Open a job by ID (from dashboard click or redirect) ───────────
async function openJob(id) {
  showScreen('search');
  // Wait for screen to render then populate
  setTimeout(async () => {
    const resultEl = document.getElementById('search-result');
    const alertEl  = document.getElementById('search-alert');
    if (!resultEl) return;
    try {
      const { job } = await API.getJob(id);
      document.getElementById('search-input').value = job.charging_number;
      renderJobDetail(job, resultEl);
    } catch (err) {
      alertEl && alertEl.append(Utils.renderAlert(err.message));
    }
  }, 50);
}

// ── Expose to window for inline onclick handlers ──────────────────
window.app = { showScreen, openJob };
