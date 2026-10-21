const { query } = require('./db');

/**
 * Insert an audit event. All fields optional except event_type.
 * @param {{ job_id?, device_id?, staff_id?, event_type, notes? }} opts
 */
async function logAudit({ job_id, device_id, staff_id, event_type, notes }) {
  try {
    await query(
      `INSERT INTO audit_events (job_id, device_id, staff_id, event_type, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [job_id || null, device_id || null, staff_id || null, event_type, notes || null]
    );
  } catch (err) {
    // Audit failures should never crash the main flow
    console.error('[audit] Failed to write audit event', err);
  }
}

module.exports = { logAudit };
