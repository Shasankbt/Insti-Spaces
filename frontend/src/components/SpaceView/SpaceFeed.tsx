import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSpacePageView, likeSpaceItem } from '../../Api';
import { itemFileUrl, itemThumbnailUrl } from '../../utils';
import { AuthenticatedImage, AuthenticatedVideo } from './AuthenticatedMedia';
import type { SpacePhoto } from '../../types';

interface SpaceFeedProps {
  spaceId: number;
  token: string;
}

const isVideoMime = (mimeType: string): boolean => mimeType.startsWith('video/');

export default function SpaceFeed({ spaceId, token }: SpaceFeedProps) {
  const navigate = useNavigate();
  const [photos, setPhotos] = useState<SpacePhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [likeBurstVisible, setLikeBurstVisible] = useState(false);
  const wheelAccumulator = useRef(0);
  const lastWheelNavAt = useRef(0);
  const lastTapAt = useRef(0);
  const lastVideoClickAt = useRef(0);
  const likeRequestInFlight = useRef(false);
  const likeBurstTimeoutRef = useRef<number | null>(null);

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

    const onFullscreenChange = () => {
      const fullscreenElement = document.fullscreenElement;
      if (!(fullscreenElement instanceof HTMLVideoElement)) return;

      if (fullscreenElement.classList.contains('space-feed__lightbox-video')) {
        void document.exitFullscreen();
      }
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [activeIndex]);

  useEffect(
    () => () => {
      if (likeBurstTimeoutRef.current != null) {
        window.clearTimeout(likeBurstTimeoutRef.current);
      }
    },
    [],
  );

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

  const showLikeBurst = useCallback(() => {
    if (likeBurstTimeoutRef.current != null) {
      window.clearTimeout(likeBurstTimeoutRef.current);
    }

    setLikeBurstVisible(false);
    window.requestAnimationFrame(() => {
      setLikeBurstVisible(true);
      likeBurstTimeoutRef.current = window.setTimeout(() => {
        setLikeBurstVisible(false);
      }, 650);
    });
  }, []);

  const handleLikeCurrentItem = useCallback(async () => {
    if (!activePhoto) {
      return;
    }

    showLikeBurst();

    if (activePhoto.likedByMe || likeRequestInFlight.current) {
      return;
    }

    likeRequestInFlight.current = true;
    setPhotos((prev) =>
      prev.map((photo) =>
        photo.photoId === activePhoto.photoId
          ? {
              ...photo,
              likedByMe: true,
              likeCount: photo.likeCount + 1,
            }
          : photo,
      ),
    );

    try {
      const { data } = await likeSpaceItem({
        spaceId,
        itemId: activePhoto.photoId,
        token,
      });
      setPhotos((prev) =>
        prev.map((photo) =>
          photo.photoId === activePhoto.photoId
            ? {
                ...photo,
                likeCount: data.likeCount,
                likedByMe: data.likedByMe,
              }
            : photo,
        ),
      );
    } catch {
      setPhotos((prev) =>
        prev.map((photo) =>
          photo.photoId === activePhoto.photoId
            ? {
                ...photo,
                likeCount: Math.max(0, photo.likeCount - 1),
                likedByMe: false,
              }
            : photo,
        ),
      );
    } finally {
      likeRequestInFlight.current = false;
    }
  }, [activePhoto, showLikeBurst, spaceId, token]);

  const handleMediaTouchEnd = useCallback(() => {
    if (!activePhoto) return;

    const now = Date.now();
    const DOUBLE_TAP_MS = 280;
    if (now - lastTapAt.current <= DOUBLE_TAP_MS) {
      lastTapAt.current = 0;
      void handleLikeCurrentItem();
      return;
    }
    lastTapAt.current = now;
  }, [activePhoto, handleLikeCurrentItem]);

  const handleVideoClickCapture = useCallback(
    (event: React.MouseEvent<HTMLVideoElement>) => {
      const now = Date.now();
      const DOUBLE_CLICK_MS = 280;
      if (now - lastVideoClickAt.current <= DOUBLE_CLICK_MS) {
        lastVideoClickAt.current = 0;
        event.preventDefault();
        event.stopPropagation();
        void handleLikeCurrentItem();
        return;
      }
      lastVideoClickAt.current = now;
    },
    [handleLikeCurrentItem],
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
              <AuthenticatedImage
                src={itemThumbnailUrl(spaceId, photo.photoId)}
                token={token}
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
                <AuthenticatedVideo
                  src={itemFileUrl(spaceId, activePhoto.photoId)}
                  token={token}
                  className="space-feed__lightbox-video"
                  controls
                  controlsList="nofullscreen"
                  disablePictureInPicture
                  autoPlay
                  playsInline
                  onClickCapture={handleVideoClickCapture}
                  onDoubleClickCapture={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void handleLikeCurrentItem();
                  }}
                  onTouchEnd={handleMediaTouchEnd}
                />
              ) : (
                <AuthenticatedImage
                  src={itemFileUrl(spaceId, activePhoto.photoId)}
                  token={token}
                  alt={activePhoto.displayName}
                  className="space-feed__lightbox-image"
                  onDoubleClick={() => {
                    void handleLikeCurrentItem();
                  }}
                  onTouchEnd={handleMediaTouchEnd}
                />
              )}
              {likeBurstVisible && <div className="space-feed__like-burst">♥</div>}
            </div>
            <div className="space-feed__lightbox-footer">
              <p className="space-feed__like-meta">
                <span>{activePhoto.likeCount} like{activePhoto.likeCount === 1 ? '' : 's'}</span>
              </p>
              <button
                type="button"
                className="space-feed__lightbox-view-full"
                onClick={() => navigate(`/spaces/${spaceId}/view/${activePhoto.photoId}`)}
              >
                View in full
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
