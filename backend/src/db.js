const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});


const createUser = async (username, email, passwordHash) => {
  const { rows } = await pool.query(
    `INSERT INTO users (username, email, password_hash)
     VALUES ($1, $2, $3) RETURNING id, username, email`,
    [username, email, passwordHash]
  );
  return rows[0];
};

const findUserByEmail = async (email) => {
  const { rows } = await pool.query(
    `SELECT * FROM users WHERE email = $1`,
    [email]
  );
  return rows[0] || null;
};

module.exports = { createUser, findUserByEmail };