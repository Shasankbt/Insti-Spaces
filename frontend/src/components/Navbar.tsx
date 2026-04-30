import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getNotificationsUnreadCount } from '../Api';
import { POLL_INTERVAL } from '../timings';

export default function Navbar() {
  const { user, token } = useAuth();
  const isLoggedIn = Boolean(user) || Boolean(token);
  const location = useLocation();
  const [unreadCount, setUnreadCount] = useState(0);

  const refreshUnread = useCallback(() => {
    if (!token) return;
    getNotificationsUnreadCount({ token })
      .then(({ data }) => setUnreadCount(data.unreadCount ?? 0))
      .catch(() => { /* swallow — the dot will just stay stale until next tick */ });
  }, [token]);

  // Initial fetch + polling. Re-fire whenever the user navigates so leaving
  // /notifications (which bumped seen_at) immediately reflects in the dot.
  useEffect(() => {
    if (!token) { setUnreadCount(0); return; }
    refreshUnread();
    const id = window.setInterval(refreshUnread, POLL_INTERVAL);
    return () => window.clearInterval(id);
  }, [token, refreshUnread, location.pathname]);

  return (
    <nav className="sidebar">
      <Link className="nav__brand" to="/">
        InstiSpace
      </Link>
      <Link className="sidebar__link" to="/">
        Home
      </Link>
      {isLoggedIn && (
        <>
          <Link className="sidebar__link" to="/friends">
            Friends
          </Link>
          <Link className="sidebar__link" to="/spaces">
            Spaces
          </Link>
          <Link className="sidebar__link sidebar__link--has-indicator" to="/notifications">
            Notifications
            {unreadCount > 0 && (
              <span
                className="sidebar__dot"
                aria-label={`${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`}
              />
            )}
          </Link>
        </>
      )}
    </nav>
  );
}
