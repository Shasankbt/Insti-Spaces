import { useMemo, useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { loginUser } from '../Api';
import type { AuthUser } from '../types';

export default function Login() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
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
    try {
      const res = await loginUser(form);
      const data = res.data as { user: AuthUser; token: string };
      login(data.user, data.token);
      void navigate(redirectTo, { replace: true });
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setError(apiErr?.error ?? 'Login failed');
    }
  };

  if (loading) return <p>Loading...</p>;

  if (user)
    return (
      <div>
        <p>
          You are already logged in as <strong>{user.username}</strong>
        </p>
        <button onClick={() => void navigate(redirectTo, { replace: true })}>Continue</button>
      </div>
    );

  return (
    <div>
      <h2>Login</h2>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <form onSubmit={(e) => void handleSubmit(e)}>
        <input name="email" placeholder="Email" onChange={handleChange} />
        <input name="password" type="password" placeholder="Password" onChange={handleChange} />
        <button type="submit">Login</button>
      </form>
      <p>
        No account? <Link to="/register">Register</Link>
      </p>
    </div>
  );
}
