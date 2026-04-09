-- =====================
-- USERS
-- =====================
INSERT INTO users (username, email, password_hash) VALUES
  ('alice',   'alice@example.com',   crypt('admin', gen_salt('bf'))),
  ('bob',     'bob@example.com',     crypt('admin', gen_salt('bf'))),
  ('charlie', 'charlie@example.com', crypt('admin', gen_salt('bf'))),
  ('diana',   'diana@example.com',   crypt('admin', gen_salt('bf'))),
  ('eve',     'eve@example.com',     crypt('admin', gen_salt('bf')));


-- =====================
-- FRIENDS
-- (fid < sid enforced by CHECK)
-- =====================
INSERT INTO friends (fid, sid) VALUES
  (1, 2),   -- alice  <-> bob
  (1, 3),   -- alice  <-> charlie
  (2, 4),   -- bob    <-> diana
  (3, 5);   -- charlie<-> eve


-- =====================
-- FRIEND REQUESTS
-- =====================
INSERT INTO friend_requests (from_user_id, to_user_id, status, responded_at) VALUES
  (4, 5, 'pending',  NULL),                          -- diana  -> eve   (open)
  (5, 1, 'accepted', NOW()),                          -- eve    -> alice (accepted)
  (2, 3, 'rejected', NOW());                          -- bob    -> charlie (rejected)


-- =====================
-- SPACES
-- =====================
INSERT INTO spaces (spacename, owner_user_id) VALUES
  ('photography', 1),
  ('travel-diaries', 4),
  ('foodies', 2),
  ('tech-talk', 1);


-- =====================
-- FOLLOWING (user-space membership with roles)
-- =====================
INSERT INTO following (userid, spaceid, role) VALUES
  (1, 1, 'admin'),        -- alice  is admin  of photography
  (2, 1, 'contributor'),  -- bob    contributes to photography
  (3, 1, 'viewer'),       -- charlie views photography
  (4, 2, 'admin'),        -- diana  is admin  of travel-diaries
  (5, 2, 'moderator'),    -- eve    moderates travel-diaries
  (1, 2, 'viewer'),       -- alice  views travel-diaries
  (2, 3, 'admin'),        -- bob    is admin  of foodies
  (3, 3, 'contributor'),  -- charlie contributes to foodies
  (1, 4, 'admin'),        -- alice  is admin  of tech-talk
  (5, 4, 'viewer');       -- eve    views tech-talk


-- =====================
-- INVITE LINKS
-- =====================
INSERT INTO invite_links (space_id, role, expires_at, single_use) VALUES
  (1, 'viewer',      NOW() + INTERVAL '7 days',  FALSE),  -- open  link for photography
  (2, 'contributor', NOW() + INTERVAL '3 days',  TRUE),   -- one-time link for travel-diaries
  (3, 'moderator',   NOW() + INTERVAL '30 days', FALSE),  -- long-lived link for foodies
  (4, 'viewer',      NULL,                        FALSE);  -- never-expiring link for tech-talk


-- =====================
-- ROLE REQUESTS
-- =====================
INSERT INTO role_requests (user_id, space_id, role, status) VALUES
  (3, 1, 'contributor', 'pending'),    -- charlie wants to contribute to photography
  (5, 3, 'moderator',   'pending'),    -- eve wants to moderate foodies
  (2, 2, 'admin',       'rejected'),   -- bob's admin request for travel-diaries was rejected
  (4, 4, 'contributor', 'accepted');   -- diana's request for tech-talk was accepted
