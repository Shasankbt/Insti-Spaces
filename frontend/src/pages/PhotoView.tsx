import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import useRequireAuth from '../hooks/useRequireAuth';
import { AuthenticatedImage, AuthenticatedVideo } from '../components/SpaceView/AuthenticatedMedia';
import { API_BASE } from '../constants';

export default function PhotoView() {
  const { id: spaceId, itemId } = useParams<{ id: string; itemId: string }>();
  const { token, loading, isAuthenticated } = useRequireAuth();
  const navigate = useNavigate();

  const [mimeType, setMimeType] = useState<string | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);

  const fileUrl = `${API_BASE}/spaces/${spaceId}/items/${itemId}/file`;

  useEffect(() => {
    if (!token || !spaceId || !itemId) return;

    const probe = async () => {
      try {
        const res = await fetch(fileUrl, {
          method: 'HEAD',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            setProbeError('You do not have access to this item.');
          } else if (res.status === 404) {
            setProbeError('Item not found.');
          } else {
            setProbeError('Failed to load item.');
          }
          return;
        }
        const ct = res.headers.get('Content-Type') ?? 'image/jpeg';
        setMimeType(ct.split(';')[0].trim());
      } catch {
        setProbeError('Failed to load item.');
      }
    };

    void probe();
  }, [token, spaceId, itemId, fileUrl]);

  if (loading) return <p>Loading…</p>;
  if (!isAuthenticated) return null;

  if (probeError) {
    return (
      <div className="photo-view">
        <div className="photo-view__header">
          <button onClick={() => navigate(-1)}>← Back</button>
        </div>
        <p className="photo-view__error">{probeError}</p>
      </div>
    );
  }

  const isVideo = mimeType?.startsWith('video/') ?? false;

  return (
    <div className="photo-view">
      <div className="photo-view__header">
        <button onClick={() => navigate(-1)}>← Back</button>
      </div>
      {mimeType == null ? (
        <p className="photo-view__loading">Loading…</p>
      ) : isVideo ? (
        <AuthenticatedVideo
          src={fileUrl}
          token={token!}
          className="photo-view__media"
          controls
          autoPlay
          playsInline
        />
      ) : (
        <AuthenticatedImage
          src={fileUrl}
          token={token!}
          alt="Media"
          className="photo-view__media"
        />
      )}
    </div>
  );
}
