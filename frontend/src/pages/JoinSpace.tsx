import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { API_BASE } from '../constants';
import axios from 'axios';

export default function JoinSpace() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const { user, loading, token } = useAuth();
  const navigate = useNavigate();
  const hasJoinedRef = useRef(false);

  const inviteToken = searchParams.get('token');

  useEffect(() => {
    if (loading) return;
    if (!user) {
      void navigate(
        `/login?redirect=${encodeURIComponent(`/spaces/join?token=${inviteToken}`)}`,
      );
      return;
    }
    if (!inviteToken) {
      setStatus('error');
      setMessage('Invalid invite link');
      return;
    }

    // React 18 StrictMode runs effects twice in dev; avoid double-POST.
    if (hasJoinedRef.current) return;
    hasJoinedRef.current = true;

    axios
      .post<{ spaceId?: number; spaceName?: string }>(
        `${API_BASE}/spaces/join-via-link`,
        { token: inviteToken },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      .then((res) => {
        const spaceId = res.data?.spaceId;
        if (spaceId) {
          void navigate(`/spaces/${spaceId}`, { replace: true });
          return;
        }
        setStatus('success');
        setMessage(res.data?.spaceName ?? 'the space');
      })
      .catch((err: unknown) => {
        const axiosErr = err as { response?: { status?: number; data?: { error?: string } } };
        if (axiosErr.response?.status === 409) {
          setStatus('success');
          setMessage('this space');
          return;
        }
        setStatus('error');
        setMessage(axiosErr.response?.data?.error ?? 'Invalid or expired invite link');
      });
  }, [loading, user, token, inviteToken, navigate]);

  if (status === 'loading') return <p>Joining space...</p>;
  if (status === 'error') return <p style={{ color: 'red' }}>{message}</p>;
  if (status === 'success')
    return (
      <div>
        <p>
          Successfully joined <strong>{message}</strong>!
        </p>
        <button onClick={() => void navigate('/')}>Go to Home</button>
      </div>
    );
}
