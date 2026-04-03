import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Navbar() {
  const { user, token } = useAuth();
  const isLoggedIn = Boolean(user) || Boolean(token);

  return (
    <header className="nav">
      <div className="nav__left">
        {isLoggedIn ? (
          <Link
            className="nav__icon"
            to="/add-friends"
            aria-label="Add friends"
            title="Add friends"
          >
            <img
              src="/addFriend.svg"
              alt="Add friends icon"
              style={{ width: "24px", height: "24px" }}
            />
          </Link>
        ) : null}
      </div>

      <div className="nav__center">
        <Link className="nav__brand" to="/">
          InstiSpace
        </Link>
      </div>

      <div className="nav__right">
        {isLoggedIn ? (
          <Link
            className="nav__icon"
            to="/notifications"
            aria-label="Notifications"
            title="Notifications"
          >
            <img
              src="/notification.svg"
              alt="Requests"
              style={{ width: "24px", height: "24px" }}
            />
          </Link>
        ) : null}
      </div>
    </header>
  );
}
