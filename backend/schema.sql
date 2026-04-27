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

-- ===================== spaces =====================
CREATE TABLE IF NOT EXISTS spaces (
  id SERIAL PRIMARY KEY,
  spacename VARCHAR(50) UNIQUE NOT NULL,
  owner_user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted BOOLEAN DEFAULT FALSE
);
-- ----------------- space management ------------------
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
  CONSTRAINT role_requests_role_check   CHECK (role IN ('contributor', 'moderator'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_role_requests_pending
ON role_requests (user_id, space_id)
WHERE status = 'pending' AND deleted = false;

CREATE INDEX IF NOT EXISTS idx_space_posts_spaceid ON space_posts (spaceid);

-- -------------------- space folders -------------------------
-- Mirrors Google Drive folder tree. NULL parent_id = top-level folder in the space.
CREATE TABLE space_folders (
    id          SERIAL       PRIMARY KEY,
    space_id    INTEGER      NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    created_by  INTEGER      NOT NULL REFERENCES users(id),
    name        TEXT         NOT NULL,
    parent_id   INTEGER      REFERENCES space_folders(id) ON DELETE CASCADE,

    -- delta sync
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    deleted     BOOLEAN      NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_space_folders_space_parent
ON space_folders (space_id, parent_id);

-- -------------------- space items ---------------------------
CREATE TABLE space_items (
    photo_id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id           INTEGER      NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    uploader_id        INTEGER      NOT NULL REFERENCES users(id),

    -- NULL folder_id = item lives at the space root (no folder)
    folder_id          INTEGER      REFERENCES space_folders(id) ON DELETE SET NULL,

    -- storage (paths relative to UPLOADS_ROOT, e.g. spaces/42/originals/uuid.jpg)
    file_path          TEXT         NOT NULL,
    thumbnail_path     TEXT         NOT NULL,
    content_hash       TEXT,
    mime_type          TEXT         NOT NULL,
    size_bytes         BIGINT       NOT NULL,

    -- metadata
    display_name       TEXT         NOT NULL,  -- original filename shown to users
    captured_at        TIMESTAMPTZ,            -- from EXIF, null if unavailable
    uploaded_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),

    -- recycle bin: NULL = active; non-null = trashed at that timestamp
    trashed_at         TIMESTAMPTZ,

    -- delta sync
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    deleted            BOOLEAN      NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_space_items_space_folder
ON space_items (space_id, folder_id);

CREATE INDEX IF NOT EXISTS idx_space_items_space_hash
ON space_items (space_id, content_hash);

-- -------------------- space item likes -----------------------
CREATE TABLE IF NOT EXISTS space_item_likes (
  space_item_id UUID        NOT NULL REFERENCES space_items(photo_id) ON DELETE CASCADE,
  user_id       INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (space_item_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_space_item_likes_item_created
ON space_item_likes (space_item_id, created_at DESC);

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

CREATE TRIGGER space_folders_updated_at
BEFORE UPDATE ON space_folders
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER space_items_updated_at
BEFORE UPDATE ON space_items
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX idx_following_userid ON following (userid) WHERE deleted = false;
CREATE INDEX idx_space_items_trashed ON space_items (trashed_at) WHERE deleted = false AND trashed_at IS NOT NULL;
CREATE INDEX idx_space_items_media_path ON space_items (space_id, file_path, thumbnail_path);
CREATE INDEX idx_role_requests_spaceid_status ON role_requests (space_id, status) WHERE deleted = false;
CREATE INDEX idx_users_username_pattern ON users (username varchar_pattern_ops);
CREATE INDEX idx_friend_requests_users ON friend_requests (from_user_id, to_user_id) WHERE status = 'pending';