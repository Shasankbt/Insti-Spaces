import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { registerUser } from '../Api';
import type { AuthUser } from '../types';

export default function Register() {
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await registerUser(form);
      const data = res.data as { user: AuthUser; token: string };
      login(data.user, data.token);
      void navigate('/');
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setError(apiErr?.error ?? 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = form.username.trim() && form.email.trim() && form.password;

  return (
    <div className="login-page">
      <div className="login-card">
        <span className="login-card__brand">InstiSpace</span>
        <h2 className="login-card__title">Create account</h2>
        <p className="login-card__subtitle">Join your institute's space</p>

        {error && (
          <div className="login-card__error" role="alert">{error}</div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} noValidate>
          <div className="login-card__field">
            <label className="login-card__label" htmlFor="reg-username">
              Username
            </label>
            <input
              id="reg-username"
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
            <label className="login-card__label" htmlFor="reg-email">
              Email
            </label>
            <input
              id="reg-email"
              className="login-card__input"
              name="email"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={handleChange}
              disabled={submitting}
            />
          </div>

          <div className="login-card__field">
            <label className="login-card__label" htmlFor="reg-password">
              Password
            </label>
            <input
              id="reg-password"
              className="login-card__input"
              name="password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={handleChange}
              disabled={submitting}
            />
          </div>

          <button
            type="submit"
            className="login-card__submit"
            disabled={submitting || !canSubmit}
          >
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="login-card__footer">
          Already have an account?{' '}
          <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
