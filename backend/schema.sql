CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS friends (
  fid INTEGER NOT NULL REFERENCES users(id),
  sid INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (fid, sid),
  CHECK (fid < sid)
);

CREATE TABLE IF NOT EXISTS friend_requests (
  id SERIAL PRIMARY KEY,
  from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(10) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,

  CONSTRAINT friend_requests_no_self CHECK (from_user_id <> to_user_id),
  CONSTRAINT friend_requests_status_check CHECK (status IN ('pending', 'accepted', 'rejected'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_friend_requests_pending_pair
ON friend_requests (from_user_id, to_user_id)
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_friend_requests_to_status_created
ON friend_requests (to_user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_friend_requests_from_status_created
ON friend_requests (from_user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS spaces (
  id SERIAL PRIMARY KEY,
  spacename VARCHAR(50) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS following (
  userid INTEGER NOT NULL REFERENCES users(id),
  spaceid INTEGER NOT NULL REFERENCES spaces(id),
  role VARCHAR(20) NOT NULL DEFAULT 'viewer',
  PRIMARY KEY (userid, spaceid),
  CONSTRAINT role_check CHECK (role IN ('viewer', 'moderator', 'contributor', 'admin'))
);

CREATE TABLE IF NOT EXISTS invite_links (
  id SERIAL PRIMARY KEY,
  token UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
  space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'viewer',
  expires_at TIMESTAMPTZ,
  single_use BOOLEAN DEFAULT FALSE,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT role_check CHECK (role IN ('viewer', 'moderator', 'contributor', 'admin'))
);

CREATE TABLE IF NOT EXISTS space_posts (
  id SERIAL PRIMARY KEY,
  spaceid INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  userid INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  photo_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
