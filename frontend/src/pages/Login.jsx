import { useMemo, useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { loginUser } from "../Api";

export default function Login() {
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState(null);
  const { login, user, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const redirectTo = useMemo(() => {
    const raw = searchParams.get("redirect");
    if (!raw) return "/";
    // Prevent open redirects; allow only internal paths.
    if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
    return "/";
  }, [searchParams]);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await loginUser(form);
      login(res.data.user, res.data.token);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || "Login failed");
    }
  };

  if (loading) return <p>Loading...</p>;

  if (user)
    return (
      <div>
        <p>
          You are already logged in as <strong>{user.username}</strong>
        </p>
        <button onClick={() => navigate(redirectTo, { replace: true })}>
          Continue
        </button>
      </div>
    );

  return (
    <div>
      <h2>Login</h2>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <form onSubmit={handleSubmit}>
        <input name="email" placeholder="Email" onChange={handleChange} />
        <input
          name="password"
          type="password"
          placeholder="Password"
          onChange={handleChange}
        />
        <button type="submit">Login</button>
      </form>
      <p>
        No account? <Link to="/register">Register</Link>
      </p>
    </div>
  );
}
