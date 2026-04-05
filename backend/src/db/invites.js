const pool = require('./pool');
const { randomUUID } = require('crypto');

const generateInviteLink = async (spaceId, role) => {
  const { rows } = await pool.query(
    `INSERT INTO invite_links (space_id, role, expires_at, single_use)
     VALUES ($1, $2, NOW() + INTERVAL '30 days', FALSE)
     RETURNING token`,
    [spaceId, role]
  );
  return rows[0].token;
};

const fetchInviteLink = async (token) => {
  const { rows } = await pool.query(
    `SELECT id, token, space_id, role, expires_at, single_use, used, created_at
     FROM invite_links
     WHERE token = $1
       AND (expires_at IS NULL OR expires_at > NOW())
       AND (single_use = FALSE OR used = FALSE)`,
    [token]
  );
  return rows[0] || null;
};

const markLinkInviteUsed = async (token) => {
  await pool.query(`UPDATE invite_links SET used = TRUE WHERE token = $1`, [token]);
};

module.exports = { generateInviteLink, fetchInviteLink, markLinkInviteUsed };
