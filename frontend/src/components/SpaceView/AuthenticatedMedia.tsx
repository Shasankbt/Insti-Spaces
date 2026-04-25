import { useEffect, useState } from 'react';
import type { ImgHTMLAttributes, VideoHTMLAttributes } from 'react';

const API_BASE = 'http://localhost:3000';

const toAbsoluteUrl = (url: string): string =>
  url.startsWith('http://') || url.startsWith('https://') ? url : `${API_BASE}${url}`;

function useAuthenticatedObjectUrl(src: string, token: string): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let nextObjectUrl: string | null = null;

    const load = async () => {
      setObjectUrl(null);
      const res = await fetch(toAbsoluteUrl(src), {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Failed to load media: ${res.status}`);

      const blob = await res.blob();
      if (controller.signal.aborted) return;

      nextObjectUrl = URL.createObjectURL(blob);
      setObjectUrl(nextObjectUrl);
    };

    void load().catch(() => {
      if (!controller.signal.aborted) setObjectUrl(null);
    });

    return () => {
      controller.abort();
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
    };
  }, [src, token]);

  return objectUrl;
}

type AuthenticatedImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string;
  token: string;
};

export function AuthenticatedImage({ src, token, ...props }: AuthenticatedImageProps) {
  const objectUrl = useAuthenticatedObjectUrl(src, token);
  return <img {...props} src={objectUrl ?? undefined} />;
}

type AuthenticatedVideoProps = Omit<VideoHTMLAttributes<HTMLVideoElement>, 'src'> & {
  src: string;
  token: string;
};

export function AuthenticatedVideo({ src, token, ...props }: AuthenticatedVideoProps) {
  const objectUrl = useAuthenticatedObjectUrl(src, token);
  return <video {...props} src={objectUrl ?? undefined} />;
}
