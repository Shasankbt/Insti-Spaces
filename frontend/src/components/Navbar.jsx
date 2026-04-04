import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Navbar() {
  const { user, token } = useAuth();
  const isLoggedIn = Boolean(user) || Boolean(token);

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
          <Link className="sidebar__link" to="/add-friends">
            Friends
          </Link>
          <Link className="sidebar__link" to="/spaces">
            Spaces
          </Link>
          <Link className="sidebar__link" to="/notifications">
            Notifications
          </Link>
        </>
      )}
    </nav>
  );
}
