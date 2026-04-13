-- drop everything in reverse dependency order
DROP TRIGGER IF EXISTS role_requests_updated_at ON role_requests;
DROP TRIGGER IF EXISTS space_posts_updated_at ON space_posts;
DROP TRIGGER IF EXISTS following_updated_at ON following;
DROP TRIGGER IF EXISTS spaces_updated_at ON spaces;

DROP FUNCTION IF EXISTS touch_updated_at();

DROP TABLE IF EXISTS role_requests CASCADE;
DROP TABLE IF EXISTS space_posts CASCADE;
DROP TABLE IF EXISTS invite_links CASCADE;
DROP TABLE IF EXISTS following CASCADE;
DROP TABLE IF EXISTS spaces CASCADE;
DROP TABLE IF EXISTS friend_requests CASCADE;
DROP TABLE IF EXISTS friends CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS space_items CASCADE;