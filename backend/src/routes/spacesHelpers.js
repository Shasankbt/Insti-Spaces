const { pool } = require('../db');

const roleRank = { viewer: 1, moderator: 2, contributor: 3, admin: 4 };

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

// Throws HttpError if caller is not an admin of spaceId. Must be called inside a transaction.
async function requireSpaceAdmin(client, spaceId, userId) {
  const { rows } = await client.query(
    `SELECT role FROM following WHERE spaceid = $1 AND userid = $2`,
    [spaceId, userId]
  );
  if (!rows.length) throw new HttpError(403, 'Not a member of this space');
  if (rows[0].role !== 'admin') throw new HttpError(403, 'Only admins can perform this action');
}

function handleError(res, err) {
  if (err instanceof HttpError) return res.status(err.status).json(err.body);
  res.status(500).json({ error: err.message });
}

module.exports = { roleRank, HttpError, parseSpaceId, withTransaction, requireSpaceAdmin, handleError };
