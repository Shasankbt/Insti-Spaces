import { useSearchParams } from 'react-router-dom';
import { AuthenticatedImage, AuthenticatedVideo } from '../components/SpaceView/AuthenticatedMedia';
import useRequireAuth from '../hooks/useRequireAuth';

const isVideoMime = (mimeType: string): boolean => mimeType.startsWith('video/');

export default function MediaView() {
  const { token, loading, isAuthenticated } = useRequireAuth();
  const [searchParams] = useSearchParams();
  const src = searchParams.get('src') ?? '';
  const name = searchParams.get('name') ?? 'Shared media';
  const mimeType = searchParams.get('type') ?? '';
  const isAllowedMediaPath = src.startsWith('/spaces/') && src.includes('/media/');

  if (loading) return <p>Loading…</p>;
  if (!isAuthenticated || !token) return null;

  if (!src || !isAllowedMediaPath) {
    return <p>Invalid media link.</p>;
  }

  return (
    <section className="media-view">
      <div className="media-view__stage">
        {isVideoMime(mimeType) ? (
          <AuthenticatedVideo
            src={src}
            token={token}
            className="media-view__video"
            controls
            autoPlay
            playsInline
          />
        ) : (
          <AuthenticatedImage src={src} token={token} alt={name} className="media-view__image" />
        )}
      </div>
      <p className="media-view__name">{name}</p>
    </section>
  );
}
