/**
 * Thin API client — wraps fetch calls to the backend.
 * All methods throw on non-2xx responses (with the server's error message).
 */

const API_BASE = '/api';

function getToken() {
  return sessionStorage.getItem('ct_token');
}

function authHeaders(extra = {}) {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function handleResponse(res) {
  let body;
  try { body = await res.json(); } catch { body = {}; }
  if (!res.ok) {
    const msg = body.error || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body   = body;
    throw err;
  }
  return body;
}

// ── Auth ─────────────────────────────────────────────────────────
export async function login(username, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return handleResponse(res);
}

export async function getMe() {
  const res = await fetch(`${API_BASE}/auth/me`, { headers: authHeaders() });
  return handleResponse(res);
}

// ── Stats / Dashboard ─────────────────────────────────────────────
export async function getStats() {
  const res = await fetch(`${API_BASE}/jobs/stats`, { headers: authHeaders() });
  return handleResponse(res);
}

// ── Jobs ──────────────────────────────────────────────────────────
export async function listJobs(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/jobs${qs ? '?' + qs : ''}`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function searchJob(chargingNumber) {
  const res = await fetch(`${API_BASE}/jobs/search/${encodeURIComponent(chargingNumber)}`, {
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function getJob(id) {
  const res = await fetch(`${API_BASE}/jobs/${id}`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function createJob(data) {
  const res = await fetch(`${API_BASE}/jobs`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function updateJobFace(jobId, face_image_path, face_consent_at) {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/face`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ face_image_path, face_consent_at }),
  });
  return handleResponse(res);
}

export async function addDeviceToJob(jobId, deviceData) {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/devices`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(deviceData),
  });
  return handleResponse(res);
}

export async function collectDevice(jobId, deviceId) {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/devices/${deviceId}/collect`, {
    method: 'PATCH',
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function collectAll(jobId) {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/collect-all`, {
    method: 'PATCH',
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function getAudit(jobId) {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/audit`, { headers: authHeaders() });
  return handleResponse(res);
}

// ── Face upload ────────────────────────────────────────────────────
export async function uploadFaceImage(blob) {
  const formData = new FormData();
  formData.append('face', blob, 'face.jpg');
  const token = getToken();
  const res = await fetch(`${API_BASE}/face/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  return handleResponse(res);
}
