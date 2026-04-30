import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSpacePageView, likeSpaceItem, unlikeSpaceItem } from '../../Api';
import { POLL_INTERVAL } from '../../timings';
import { itemFileUrl, itemThumbnailUrl } from '../../utils';
import { AuthenticatedImage, AuthenticatedVideo } from './AuthenticatedMedia';
import type { SpacePhoto } from '../../types';

interface SpaceFeedProps {
  spaceId: number;
  token: string;
  active: boolean;
}

const isVideoMime = (mimeType: string): boolean => mimeType.startsWith('video/');
const FEED_LOADING_BUFFER_MS = 1000;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

const mediaUrlWithToken = (src: string, token: string): string => {
  const url = new URL(src);
  url.searchParams.set('t', token);
  return url.toString();
};

export default function SpaceFeed({ spaceId, token, active }: SpaceFeedProps) {
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
  const likeRequestInFlight = useRef(new Set<string>());
  const likeBurstTimeoutRef = useRef<number | null>(null);

  const fetchPhotos = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const [{ data }] = await Promise.all([
        getSpacePageView({ spaceId, token }),
        silent ? Promise.resolve() : wait(FEED_LOADING_BUFFER_MS),
      ]);
      setPhotos(data.photos ?? []);
    } catch {
      if (!silent) {
        setError('Failed to load feed photos');
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [spaceId, token]);

  useEffect(() => {
    if (!active || photos.length > 0) return;
    void fetchPhotos();
  }, [active, fetchPhotos, photos.length]);

  useEffect(() => {
    if (!active) return undefined;

    const id = window.setInterval(() => {
      if (document.hidden) return;
      void fetchPhotos({ silent: true });
    }, POLL_INTERVAL);
    return () => window.clearInterval(id);
  }, [active, fetchPhotos]);

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

  const handleLikeItem = useCallback(async (photoId: string, showBurst = false) => {
    const targetPhoto = photos.find((photo) => photo.photoId === photoId);
    if (!targetPhoto) {
      return;
    }

    if (showBurst) {
      showLikeBurst();
    }

    if (likeRequestInFlight.current.has(photoId)) {
      return;
    }

    const isLiked = targetPhoto.likedByMe;
    likeRequestInFlight.current.add(photoId);
    setPhotos((prev) =>
      prev.map((photo) =>
        photo.photoId === photoId
          ? {
              ...photo,
              likedByMe: !isLiked,
              likeCount: isLiked ? photo.likeCount - 1 : photo.likeCount + 1,
            }
          : photo,
      ),
    );

    try {
      const { data } = isLiked
        ? await unlikeSpaceItem({ spaceId, itemId: photoId, token })
        : await likeSpaceItem({ spaceId, itemId: photoId, token });
      setPhotos((prev) =>
        prev.map((photo) =>
          photo.photoId === photoId
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
          photo.photoId === photoId
            ? {
                ...photo,
                likeCount: Math.max(0, photo.likeCount - 1),
                likedByMe: false,
              }
            : photo,
        ),
      );
    } finally {
      likeRequestInFlight.current.delete(photoId);
    }
  }, [photos, showLikeBurst, spaceId, token]);

  const handleLikeCurrentItem = useCallback(async () => {
    if (!activePhoto) {
      return;
    }

    await handleLikeItem(activePhoto.photoId, true);
  }, [activePhoto, handleLikeItem]);

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

      {loading && (
        <div className="space-feed__loading" role="status" aria-live="polite">
          <span className="space-feed__loader" aria-hidden="true" />
          <span>Loading feed</span>
        </div>
      )}
      {!loading && error && <p className="space-feed__message space-feed__message--error">{error}</p>}
      {!loading && !error && photos.length === 0 && (
        <p className="space-feed__message">No photos in this space yet.</p>
      )}

      {!loading && photos.length > 0 && (
        <div className="space-feed__grid">
          {photos.map((photo, index) => (
            <div key={photo.photoId} className="space-feed__tile">
              <button
                type="button"
                title={photo.displayName}
                className="space-feed__link"
                onClick={() => setActiveIndex(index)}
              >
                <img
                  src={mediaUrlWithToken(itemThumbnailUrl(spaceId, photo.photoId), token)}
                  alt={photo.displayName}
                  loading="lazy"
                  decoding="async"
                  className="space-feed__thumb"
                />
              </button>
              <button
                type="button"
                aria-label={`${photo.likedByMe ? 'Liked' : 'Like'} ${photo.displayName}`}
                className={`space-feed__thumb-like ${photo.likedByMe ? 'space-feed__thumb-like--active' : ''}`}
                onClick={() => void handleLikeItem(photo.photoId)}
                disabled={likeRequestInFlight.current.has(photo.photoId)}
              >
                <span aria-hidden="true">♥</span>
                <span>{photo.likeCount}</span>
              </button>
            </div>
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
                className={`space-feed__lightbox-like ${activePhoto.likedByMe ? 'space-feed__lightbox-like--active' : ''}`}
                onClick={() => void handleLikeCurrentItem()}
                disabled={likeRequestInFlight.current.has(activePhoto.photoId)}
              >
                <span aria-hidden="true">♥</span>
                {activePhoto.likedByMe ? 'Liked' : 'Like'}
              </button>
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
