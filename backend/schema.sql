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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS following (
  userid INTEGER NOT NULL REFERENCES users(id),
  spaceid INTEGER NOT NULL REFERENCES spaces(id),
  role VARCHAR(20) NOT NULL DEFAULT 'viewer',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted BOOLEAN DEFAULT FALSE,
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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS role_requests (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  space_id   INTEGER NOT NULL REFERENCES spaces(id)  ON DELETE CASCADE,
  role       VARCHAR(20) NOT NULL,
  status     VARCHAR(10) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted BOOLEAN DEFAULT FALSE,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',

  CONSTRAINT role_requests_status_check CHECK (status IN ('pending', 'accepted', 'rejected')),
  CONSTRAINT role_requests_role_check   CHECK (role IN ('contributor', 'moderator', 'admin')),
  CONSTRAINT role_requests_no_viewer    CHECK (role <> 'viewer')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_role_requests_pending
ON role_requests (user_id, space_id)
WHERE status = 'pending' AND deleted = false;

CREATE INDEX IF NOT EXISTS idx_space_posts_spaceid ON space_posts (spaceid);

-- auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER spaces_updated_at
BEFORE UPDATE ON spaces
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER following_updated_at
BEFORE UPDATE ON following
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER space_posts_updated_at
BEFORE UPDATE ON space_posts
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER role_requests_updated_at
BEFORE UPDATE ON role_requests
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
