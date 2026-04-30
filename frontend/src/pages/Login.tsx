import { useMemo, useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { loginUser } from '../Api';
import type { AuthUser } from '../types';

export default function Login() {
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { login, user, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const redirectTo = useMemo(() => {
    const raw = searchParams.get('redirect');
    if (!raw) return '/';
    if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
    return '/';
  }, [searchParams]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await loginUser(form);
      const data = res.data as { user: AuthUser; token: string };
      login(data.user, data.token);
      void navigate(redirectTo, { replace: true });
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setError(apiErr?.error ?? 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="login-page"><div className="login-card__loading">Loading…</div></div>;

  if (user)
    return (
      <div className="login-page">
        <div className="login-card">
          <span className="login-card__brand">InstiSpace</span>
          <h2 className="login-card__title">Already signed in</h2>
          <p className="login-card__subtitle">You're logged in as <strong>{user.username}</strong>.</p>
          <button
            className="login-card__submit"
            onClick={() => void navigate(redirectTo, { replace: true })}
          >
            Continue
          </button>
        </div>
      </div>
    );

  return (
    <div className="login-page">
      <div className="login-card">
        <span className="login-card__brand">InstiSpace</span>
        <h2 className="login-card__title">Welcome back</h2>
        <p className="login-card__subtitle">Sign in to your account</p>

        {error && (
          <div className="login-card__error" role="alert">{error}</div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} noValidate>
          <div className="login-card__field">
            <label className="login-card__label" htmlFor="login-username">
              Email or username
            </label>
            <input
              id="login-username"
              className="login-card__input"
              name="username"
              autoComplete="username"
              autoFocus
              value={form.username}
              onChange={handleChange}
              disabled={submitting}
            />
          </div>

          <div className="login-card__field">
            <label className="login-card__label" htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              className="login-card__input"
              name="password"
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={handleChange}
              disabled={submitting}
            />
          </div>

          <button
            type="submit"
            className="login-card__submit"
            disabled={submitting || !form.username || !form.password}
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="login-card__footer">
          No account?{' '}
          <Link to="/register">Create one</Link>
        </p>
      </div>
    </div>
  );
}
