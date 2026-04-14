import { useCallback, useEffect, useRef, useState } from 'react';
import { getSpacePageView } from '../../Api';
import type { SpacePhoto } from '../../types';

const API_BASE = 'http://localhost:3000';

interface SpaceFeedProps {
  spaceId: number;
  token: string;
}

const toAbsoluteUrl = (url: string): string =>
  url.startsWith('http://') || url.startsWith('https://') ? url : `${API_BASE}${url}`;

const isVideoMime = (mimeType: string): boolean => mimeType.startsWith('video/');

export default function SpaceFeed({ spaceId, token }: SpaceFeedProps) {
  const [photos, setPhotos] = useState<SpacePhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const wheelAccumulator = useRef(0);
  const lastWheelNavAt = useRef(0);

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

  useEffect(() => {
    if (activeIndex == null) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex(null);
        return;
      } else if (event.key === 'ArrowLeft') {
        setActiveIndex((prev) => {
          if (prev == null) return prev;
          return Math.max(0, prev - 1);
        });
      } else if (event.key === 'ArrowRight') {
        setActiveIndex((prev) => {
          if (prev == null) return prev;
          return Math.min(photos.length - 1, prev + 1);
        });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeIndex, photos.length]);

  useEffect(() => {
    if (activeIndex == null) return;
    if (photos.length === 0) {
      setActiveIndex(null);
      return;
    }
    if (activeIndex >= photos.length) {
      setActiveIndex(photos.length - 1);
    }
  }, [activeIndex, photos]);

  const activePhoto = activeIndex == null ? null : photos[activeIndex] ?? null;
  const hasPrev = activeIndex != null && activeIndex > 0;
  const hasNext = activeIndex != null && activeIndex < photos.length - 1;

  const handleLightboxWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (activeIndex == null) return;

      const horizontalDelta = event.deltaX;
      if (Math.abs(horizontalDelta) < 1) return;

      if (event.cancelable) {
        event.preventDefault();
      }
      wheelAccumulator.current += horizontalDelta;

      const THRESHOLD = 36;
      if (Math.abs(wheelAccumulator.current) < THRESHOLD) return;

      const now = Date.now();
      const COOLDOWN_MS = 220;
      if (now - lastWheelNavAt.current < COOLDOWN_MS) return;

      if (wheelAccumulator.current > 0 && activeIndex < photos.length - 1) {
        setActiveIndex((prev) => (prev == null ? prev : Math.min(photos.length - 1, prev + 1)));
      } else if (wheelAccumulator.current < 0 && activeIndex > 0) {
        setActiveIndex((prev) => (prev == null ? prev : Math.max(0, prev - 1)));
      }

      lastWheelNavAt.current = now;
      wheelAccumulator.current = 0;
    },
    [activeIndex, photos.length],
  );

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
          {photos.map((photo, index) => (
            <button
              key={photo.photoId}
              type="button"
              title={photo.displayName}
              className="space-feed__link"
              onClick={() => setActiveIndex(index)}
            >
              <img
                src={toAbsoluteUrl(photo.thumbnailUrl)}
                alt={photo.displayName}
                loading="lazy"
                className="space-feed__thumb"
              />
            </button>
          ))}
        </div>
      )}

      {activePhoto && (
        <div
          className="space-feed__lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={activePhoto.displayName}
          onClick={() => setActiveIndex(null)}
        >
          <div className="space-feed__lightbox-content" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="space-feed__lightbox-close"
              onClick={(event) => {
                event.stopPropagation();
                setActiveIndex(null);
              }}
              aria-label="Close image"
            >
              ✕
            </button>
            <div className="space-feed__lightbox-stage" onWheel={handleLightboxWheel}>
              <button
                type="button"
                className="space-feed__lightbox-hit space-feed__lightbox-hit--prev"
                onClick={(event) => {
                  event.stopPropagation();
                  setActiveIndex((prev) => (prev == null ? prev : Math.max(0, prev - 1)));
                }}
                disabled={!hasPrev}
                aria-label="Previous image"
              />
              <button
                type="button"
                className="space-feed__lightbox-hit space-feed__lightbox-hit--next"
                onClick={(event) => {
                  event.stopPropagation();
                  setActiveIndex((prev) => (prev == null ? prev : Math.min(photos.length - 1, prev + 1)));
                }}
                disabled={!hasNext}
                aria-label="Next image"
              />
              {isVideoMime(activePhoto.mimeType) ? (
                <video
                  src={toAbsoluteUrl(activePhoto.fileUrl)}
                  className="space-feed__lightbox-video"
                  controls
                  autoPlay
                  playsInline
                />
              ) : (
                <img
                  src={toAbsoluteUrl(activePhoto.fileUrl)}
                  alt={activePhoto.displayName}
                  className="space-feed__lightbox-image"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
