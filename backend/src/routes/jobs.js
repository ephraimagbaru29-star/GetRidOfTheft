const express = require('express');
const { query, pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../audit');

const router = express.Router();

// ---------------------------------------------------------------
// GET /api/jobs/stats  — dashboard counts
// ---------------------------------------------------------------
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const result = await query(`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('active','partial'))   AS active_jobs,
        COUNT(*) FILTER (WHERE status = 'active')               AS fully_active,
        COUNT(*) FILTER (WHERE status = 'partial')              AS partial_jobs,
        COUNT(*) FILTER (WHERE status = 'closed')               AS closed_jobs
      FROM charging_jobs
    `);

    const devResult = await query(`
      SELECT COUNT(*) AS devices_in_shop FROM devices WHERE status = 'in_shop'
    `);

    // Numbers reusable = closed jobs whose charging_number is not active elsewhere
    // We just return the counts the dashboard needs
    const stats = {
      active_jobs:     parseInt(result.rows[0].active_jobs, 10),
      partial_jobs:    parseInt(result.rows[0].partial_jobs, 10),
      closed_jobs:     parseInt(result.rows[0].closed_jobs, 10),
      devices_in_shop: parseInt(devResult.rows[0].devices_in_shop, 10),
    };
    return res.json({ stats });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------
// GET /api/jobs  — list jobs (optional ?status=active|partial|closed&search=)
// ---------------------------------------------------------------
router.get('/', requireAuth, async (req, res) => {
  const { status, search } = req.query;
  const params = [];
  const conditions = [];

  if (status && ['active', 'partial', 'closed'].includes(status)) {
    params.push(status);
    conditions.push(`j.status = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(j.charging_number ILIKE $${params.length} OR j.customer_name ILIKE $${params.length})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT j.*,
              s.display_name AS created_by_name,
              COUNT(d.id) AS total_devices,
              COUNT(d.id) FILTER (WHERE d.status = 'in_shop') AS devices_in_shop
       FROM charging_jobs j
       LEFT JOIN staff_users s ON s.id = j.created_by
       LEFT JOIN devices d ON d.job_id = j.id
       ${where}
       GROUP BY j.id, s.display_name
       ORDER BY j.created_at DESC
       LIMIT 200`,
      params
    );
    return res.json({ jobs: result.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------
// GET /api/jobs/search/:number  — search by charging number
// ---------------------------------------------------------------
router.get('/search/:number', requireAuth, async (req, res) => {
  const charging_number = req.params.number.trim().toUpperCase();
  try {
    // Look for active/partial first, then most recent closed
    const result = await query(
      `SELECT j.*,
              s.display_name AS created_by_name
       FROM charging_jobs j
       LEFT JOIN staff_users s ON s.id = j.created_by
       WHERE j.charging_number = $1
       ORDER BY
         CASE j.status WHEN 'active' THEN 1 WHEN 'partial' THEN 2 ELSE 3 END,
         j.created_at DESC
       LIMIT 1`,
      [charging_number]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'No job found for that charging number' });
    }
    const job = result.rows[0];

    // Fetch devices
    const devResult = await query(
      `SELECT d.*, cs.display_name AS collected_by_name, ab.display_name AS added_by_name
       FROM devices d
       LEFT JOIN staff_users cs ON cs.id = d.collected_by
       LEFT JOIN staff_users ab ON ab.id = d.added_by
       WHERE d.job_id = $1
       ORDER BY d.added_at`,
      [job.id]
    );
    job.devices = devResult.rows;
    return res.json({ job });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------
// GET /api/jobs/:id  — single job with devices
// ---------------------------------------------------------------
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const result = await query(
      `SELECT j.*, s.display_name AS created_by_name
       FROM charging_jobs j
       LEFT JOIN staff_users s ON s.id = j.created_by
       WHERE j.id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Job not found' });
    const job = result.rows[0];

    const devResult = await query(
      `SELECT d.*, cs.display_name AS collected_by_name, ab.display_name AS added_by_name
       FROM devices d
       LEFT JOIN staff_users cs ON cs.id = d.collected_by
       LEFT JOIN staff_users ab ON ab.id = d.added_by
       WHERE d.job_id = $1
       ORDER BY d.added_at`,
      [job.id]
    );
    job.devices = devResult.rows;

    const auditResult = await query(
      `SELECT ae.*, s.display_name AS staff_name
       FROM audit_events ae
       LEFT JOIN staff_users s ON s.id = ae.staff_id
       WHERE ae.job_id = $1
       ORDER BY ae.event_time`,
      [job.id]
    );
    job.audit = auditResult.rows;

    return res.json({ job });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------
// POST /api/jobs  — create a new job (with devices)
// Face image path is set separately via PATCH /api/jobs/:id/face
// ---------------------------------------------------------------
router.post('/', requireAuth, async (req, res) => {
  const { charging_number, customer_name, contact_optional, notes, devices } = req.body;

  if (!charging_number || !customer_name) {
    return res.status(400).json({ error: 'charging_number and customer_name are required' });
  }
  if (!Array.isArray(devices) || devices.length === 0) {
    return res.status(400).json({ error: 'At least one device is required' });
  }

  const cn = charging_number.trim().toUpperCase();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check for existing active/partial job — enforced by DB unique index too
    const existing = await client.query(
      `SELECT id, customer_name, status FROM charging_jobs
       WHERE charging_number = $1 AND status IN ('active','partial')`,
      [cn]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'This charging number already has an active job. Collect all devices first.',
        existing_job: existing.rows[0],
      });
    }

    // Insert job
    const jobResult = await client.query(
      `INSERT INTO charging_jobs (charging_number, customer_name, contact_optional, notes, created_by, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       RETURNING *`,
      [cn, customer_name.trim(), contact_optional || null, notes || null, req.staff.id]
    );
    const job = jobResult.rows[0];

    // Insert devices
    const insertedDevices = [];
    for (const dev of devices) {
      if (!dev.device_type || !dev.brand_model || !dev.colour) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Each device needs device_type, brand_model, and colour' });
      }
      const dResult = await client.query(
        `INSERT INTO devices (job_id, device_type, brand_model, colour, identifier_optional, condition_notes, accessories, added_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [job.id, dev.device_type.trim(), dev.brand_model.trim(), dev.colour.trim(),
         dev.identifier_optional || null, dev.condition_notes || null, dev.accessories || null, req.staff.id]
      );
      insertedDevices.push(dResult.rows[0]);
    }

    // Audit
    await client.query(
      `INSERT INTO audit_events (job_id, staff_id, event_type, notes)
       VALUES ($1, $2, 'job_created', $3)`,
      [job.id, req.staff.id, `Job created with ${insertedDevices.length} device(s)`]
    );

    await client.query('COMMIT');
    job.devices = insertedDevices;
    return res.status(201).json({ job });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'This charging number already has an active job (concurrent registration blocked).',
      });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------
// PATCH /api/jobs/:id/face  — attach face image path + consent time
// ---------------------------------------------------------------
router.patch('/:id/face', requireAuth, async (req, res) => {
  const { face_image_path, face_consent_at } = req.body;
  if (!face_image_path) return res.status(400).json({ error: 'face_image_path is required' });

  try {
    const result = await query(
      `UPDATE charging_jobs
       SET face_image_path = $1, face_consent_at = $2
       WHERE id = $3
       RETURNING id, charging_number, customer_name, face_image_path, face_consent_at`,
      [face_image_path, face_consent_at || new Date().toISOString(), req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Job not found' });

    await logAudit({ job_id: req.params.id, staff_id: req.staff.id, event_type: 'face_captured', notes: 'Face image recorded with consent' });

    return res.json({ job: result.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------
// POST /api/jobs/:id/devices  — add device to existing active job
// ---------------------------------------------------------------
router.post('/:id/devices', requireAuth, async (req, res) => {
  const { device_type, brand_model, colour, identifier_optional, condition_notes, accessories, reason } = req.body;
  if (!device_type || !brand_model || !colour) {
    return res.status(400).json({ error: 'device_type, brand_model, and colour are required' });
  }

  try {
    // Verify job is active or partial
    const jobResult = await query(
      `SELECT id, status, charging_number FROM charging_jobs WHERE id = $1`,
      [req.params.id]
    );
    if (!jobResult.rows.length) return res.status(404).json({ error: 'Job not found' });
    const job = jobResult.rows[0];
    if (job.status === 'closed') return res.status(409).json({ error: 'Cannot add devices to a closed job' });

    const dResult = await query(
      `INSERT INTO devices (job_id, device_type, brand_model, colour, identifier_optional, condition_notes, accessories, added_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [req.params.id, device_type.trim(), brand_model.trim(), colour.trim(),
       identifier_optional || null, condition_notes || null, accessories || null, req.staff.id]
    );

    await logAudit({
      job_id: req.params.id,
      device_id: dResult.rows[0].id,
      staff_id: req.staff.id,
      event_type: 'device_added',
      notes: reason || 'Device added to existing job',
    });

    return res.status(201).json({ device: dResult.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------
// PATCH /api/jobs/:id/devices/:deviceId/collect  — collect one device
// ---------------------------------------------------------------
router.patch('/:id/devices/:deviceId/collect', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Mark device collected
    const devResult = await client.query(
      `UPDATE devices
       SET status = 'collected', collected_at = NOW(), collected_by = $1
       WHERE id = $2 AND job_id = $3 AND status = 'in_shop'
       RETURNING *`,
      [req.staff.id, req.params.deviceId, req.params.id]
    );
    if (!devResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Device not found or already collected' });
    }

    await client.query(
      `INSERT INTO audit_events (job_id, device_id, staff_id, event_type, notes)
       VALUES ($1, $2, $3, 'device_collected', 'Device marked as collected')`,
      [req.params.id, req.params.deviceId, req.staff.id]
    );

    // Check if all devices are now collected → close job
    const remaining = await client.query(
      `SELECT COUNT(*) AS cnt FROM devices WHERE job_id = $1 AND status = 'in_shop'`,
      [req.params.id]
    );
    const allCollected = parseInt(remaining.rows[0].cnt, 10) === 0;

    let newStatus = 'partial';
    if (allCollected) {
      await client.query(
        `UPDATE charging_jobs SET status = 'closed', closed_at = NOW() WHERE id = $1`,
        [req.params.id]
      );
      await client.query(
        `INSERT INTO audit_events (job_id, staff_id, event_type, notes)
         VALUES ($1, $2, 'job_closed', 'All devices collected — job closed, number available for reuse')`,
        [req.params.id, req.staff.id]
      );
      newStatus = 'closed';
    } else {
      await client.query(
        `UPDATE charging_jobs SET status = 'partial' WHERE id = $1 AND status = 'active'`,
        [req.params.id]
      );
    }

    await client.query('COMMIT');
    return res.json({ device: devResult.rows[0], job_status: newStatus });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------
// PATCH /api/jobs/:id/collect-all  — collect every remaining device
// ---------------------------------------------------------------
router.patch('/:id/collect-all', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const devResult = await client.query(
      `UPDATE devices
       SET status = 'collected', collected_at = NOW(), collected_by = $1
       WHERE job_id = $2 AND status = 'in_shop'
       RETURNING id`,
      [req.staff.id, req.params.id]
    );

    if (devResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'No devices remaining to collect' });
    }

    // Audit each device
    for (const row of devResult.rows) {
      await client.query(
        `INSERT INTO audit_events (job_id, device_id, staff_id, event_type, notes)
         VALUES ($1, $2, $3, 'device_collected', 'Collected via collect-all')`,
        [req.params.id, row.id, req.staff.id]
      );
    }

    // Close job
    await client.query(
      `UPDATE charging_jobs SET status = 'closed', closed_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    await client.query(
      `INSERT INTO audit_events (job_id, staff_id, event_type, notes)
       VALUES ($1, $2, 'job_closed', 'All devices collected at once — job closed')`,
      [req.params.id, req.staff.id]
    );

    await client.query('COMMIT');
    return res.json({ collected: devResult.rowCount, job_status: 'closed' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------
// GET /api/jobs/:id/audit  — audit history for a job
// ---------------------------------------------------------------
router.get('/:id/audit', requireAuth, async (req, res) => {
  try {
    const result = await query(
      `SELECT ae.*, s.display_name AS staff_name
       FROM audit_events ae
       LEFT JOIN staff_users s ON s.id = ae.staff_id
       WHERE ae.job_id = $1
       ORDER BY ae.event_time`,
      [req.params.id]
    );
    return res.json({ audit: result.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
