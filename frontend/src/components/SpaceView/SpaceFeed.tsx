import { useCallback, useEffect, useState } from 'react';
import { getSpacePageView } from '../../Api';
import type { SpacePhoto } from '../../types';

const API_BASE = 'http://localhost:3000';

interface SpaceFeedProps {
  spaceId: number;
  token: string;
}

const toAbsoluteUrl = (url: string): string =>
  url.startsWith('http://') || url.startsWith('https://') ? url : `${API_BASE}${url}`;

export default function SpaceFeed({ spaceId, token }: SpaceFeedProps) {
  const [photos, setPhotos] = useState<SpacePhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPhotos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await getSpacePageView({ spaceId, token });
      setPhotos(data.photos ?? []);
    } catch {
      setError('Failed to load feed photos');
    } finally {
      setLoading(false);
    }
  }, [spaceId, token]);

  useEffect(() => {
    void fetchPhotos();
  }, [fetchPhotos]);

  return (
    <section className="space-feed">
      <div className="space-feed__header">
        <h3 className="space-feed__title">Feed</h3>
        <button onClick={() => void fetchPhotos()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {loading && photos.length === 0 && <p className="space-feed__message">Loading photos…</p>}
      {error && <p className="space-feed__message space-feed__message--error">{error}</p>}
      {!loading && !error && photos.length === 0 && (
        <p className="space-feed__message">No photos in this space yet.</p>
      )}

      {photos.length > 0 && (
        <div className="space-feed__grid">
          {photos.map((photo) => (
            <a
              key={photo.photoId}
              href={toAbsoluteUrl(photo.fileUrl)}
              target="_blank"
              rel="noreferrer"
              title={photo.displayName}
              className="space-feed__link"
            >
              <img
                src={toAbsoluteUrl(photo.thumbnailUrl)}
                alt={photo.displayName}
                loading="lazy"
                className="space-feed__thumb"
              />
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
