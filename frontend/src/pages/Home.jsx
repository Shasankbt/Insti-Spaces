import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Home() {
  const { user, loading } = useAuth();

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      <h1>Insti Spaces</h1>
      <p>Share spaces, manage members, and collaborate with your community.</p>
      {user ? (
        <p>
          Welcome back, <strong>{user.username}</strong>. Head over to your{" "}
          <Link to="/spaces">spaces</Link>.
        </p>
      ) : (
        <p>
          <Link to="/login">Login</Link> or <Link to="/register">create an account</Link>{" "}
          to get started.
        </p>
      )}
    </div>
  );
}
