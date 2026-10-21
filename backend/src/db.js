const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL client error', err);
});

/**
 * Run a parameterised query.
 * @param {string} text   SQL string with $1, $2 … placeholders
 * @param {Array}  params Parameter values
 */
async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[db] ${text.slice(0, 60)}… (${Date.now() - start}ms, rows=${res.rowCount})`);
  }
  return res;
}

module.exports = { query, pool };
