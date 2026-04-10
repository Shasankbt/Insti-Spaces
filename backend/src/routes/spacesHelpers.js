const { pool } = require('../db');

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

class HttpError extends Error {
  constructor(status, errorOrMessage) {
    const body = typeof errorOrMessage === 'string'
      ? { error: errorOrMessage }
      : errorOrMessage;
    super(body.error || body.message || 'Error');
    this.status = status;
    this.body = body;
  }
}

function parseSpaceId(req) {
  const id = Number(req.params.spaceId);
  return Number.isFinite(id) ? id : null;
}

// Throws HttpError if caller does not have one of the allowedRoles in the space.
// Returns the caller's role. Must be called inside a transaction.
async function requireSpaceRole(client, spaceId, userId, allowedRoles) {
  const { rows } = await client.query(
    `SELECT role FROM following WHERE spaceid = $1 AND userid = $2 AND deleted = false`,
    [spaceId, userId]
  );
  if (!rows.length) throw new HttpError(403, 'Not a member of this space');
  if (!allowedRoles.includes(rows[0].role)) {
    throw new HttpError(403, 'Insufficient permissions');
  }
  return rows[0].role;
}

function handleError(res, err) {
  if (err instanceof HttpError) return res.status(err.status).json(err.body);
  res.status(500).json({ error: err.message });
}

module.exports = { HttpError, parseSpaceId, withTransaction, requireSpaceRole, handleError };
