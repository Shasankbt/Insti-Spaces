import { useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import { uploadToSpace, uploadVideoFile } from '../../Api';
import type { RecoverableUploadError } from '../../Api';
import type { Space } from '../../types';
import { UPLOAD_SUCCESS_DISMISS_MS } from '../../timings';

interface MediaPreview {
  url: string;
  kind: 'image' | 'video';
}

interface ResumableUploadSummary {
  sessionId: string;
  uploadedCount: number;
  totalCount: number;
  pendingCount: number;
  message: string;
}

interface UploadModalProps {
  space: Space;
  token: string;
  folderId?: number | null;
  initialFiles?: File[];
  onClose: () => void;
  onItemsCommitted?: () => void;
  onResumableUploadChange?: (summary: ResumableUploadSummary | null) => void;
  onPendingFilesChange?: (files: File[]) => void;
  resumeSignal?: number;
}

const computeSha256Hex = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const buildPreviews = (files: File[]): MediaPreview[] =>
  files.map((file) => ({
    url: URL.createObjectURL(file),
    kind: file.type.startsWith('video/') ? 'video' : 'image',
  }));

const revokePreviews = (previews: MediaPreview[]): void => {
  previews.forEach((preview) => URL.revokeObjectURL(preview.url));
};

export default function UploadModal({
  space,
  token,
  folderId,
  initialFiles,
  onClose,
  onItemsCommitted,
  onResumableUploadChange,
  onPendingFilesChange,
  resumeSignal,
}: UploadModalProps) {
  const [files, setFiles] = useState<File[]>(initialFiles ?? []);
  const [previews, setPreviews] = useState<MediaPreview[]>(() => buildPreviews(initialFiles ?? []));
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [resumeReady, setResumeReady] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef<MediaPreview[]>([]);
  const lastResumeSignalRef = useRef<number>(resumeSignal ?? 0);
  const videoResumeFromRef = useRef<{ sessionId: string; nextChunkIndex: number; totalChunks: number } | null>(null);

  useEffect(() => {
    if (!initialFiles || initialFiles.length === 0) return;
    setSelection(initialFiles);
  }, [initialFiles]);

  useEffect(
    () => () => {
      revokePreviews(previewUrlsRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!resumeReady) return;
    const currentSignal = resumeSignal ?? 0;
    if (currentSignal === lastResumeSignalRef.current) return;
    lastResumeSignalRef.current = currentSignal;
    void submitFiles(files);
  }, [files, resumeReady, resumeSignal]);

  const setSelection = (nextFiles: File[]) => {
    revokePreviews(previewUrlsRef.current);
    const nextPreviews = buildPreviews(nextFiles);
    previewUrlsRef.current = nextPreviews;
    setFiles(nextFiles);
    setPreviews(nextPreviews);
    onPendingFilesChange?.(nextFiles);
  };

  const clearResumableState = () => {
    setResumeReady(false);
    videoResumeFromRef.current = null;
    onResumableUploadChange?.(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    setSelection(selected);
    clearResumableState();
    setUploadError(null);
    setUploadSuccess(null);
  };

  const handleRemove = (index: number) => {
    const nextFiles = files.filter((_, currentIndex) => currentIndex !== index);
    setSelection(nextFiles);
    clearResumableState();
    setUploadError(null);
    setUploadSuccess(null);
  };

  const submitFiles = async (filesToUpload: File[]) => {
    if (filesToUpload.length === 0) return;

    setUploadError(null);
    setUploadSuccess(null);
    try {
      setUploading(true);

      const videoFiles = filesToUpload.filter((file) => file.type.startsWith('video/'));
      const imageFiles = filesToUpload.filter((file) => !file.type.startsWith('video/'));

      if (imageFiles.length > 0) {
        const formData = new FormData();
        imageFiles.forEach((file) => formData.append('items', file));

        // crypto.subtle is only available in secure contexts (HTTPS / localhost).
        // Skip hashing on plain HTTP — hashes are stored for future duplicate detection.
        if (typeof crypto !== 'undefined' && crypto.subtle) {
          const fileHashes = await Promise.all(imageFiles.map((file) => computeSha256Hex(file)));
          formData.append('content_hashes', JSON.stringify(fileHashes));
        }

        if (folderId != null) formData.append('folder_id', String(folderId));
        const response = await uploadToSpace({ spaceId: space.id, formData, token });
        const data = response.data;

        if (response.status === 409 && data.recoverable) {
          const uploadedCount = data.uploadedCount ?? Math.max(0, imageFiles.length - (data.pendingCount ?? 0));
          const pendingFiles = imageFiles.slice(uploadedCount);
          const pendingCount = data.pendingCount ?? pendingFiles.length;
          const message = data.error ?? `Upload paused after ${uploadedCount} item${uploadedCount === 1 ? '' : 's'}.`;

          setResumeReady(true);
          onItemsCommitted?.();
          onResumableUploadChange?.({
            sessionId: data.uploadSessionId ?? `sim-${Date.now()}`,
            uploadedCount,
            totalCount: data.totalCount ?? imageFiles.length,
            pendingCount,
            message,
          });

          setUploadError(message);
          setUploadSuccess(null);
          setSelection(pendingFiles);
          return;
        }
      }

      for (const videoFile of videoFiles) {
        const videoHash = typeof crypto !== 'undefined' && crypto.subtle ? await computeSha256Hex(videoFile) : null;
        try {
          await uploadVideoFile({
            spaceId: space.id,
            file: videoFile,
            token,
            folderId,
            contentHash: videoHash,
            resumeFrom: videoResumeFromRef.current ?? undefined,
          });
          videoResumeFromRef.current = null;
        } catch (err: unknown) {
          // If server simulated a recoverable pause, show resume banner and preserve file selection
          const isRecoverable = (err as RecoverableUploadError)?.details !== undefined;
          if (isRecoverable) {
            const details = (err as RecoverableUploadError).details;
            const uploadedCount = details.nextChunkIndex;
            const pendingCount = details.totalChunks - details.nextChunkIndex;

            videoResumeFromRef.current = {
              sessionId: details.sessionId,
              nextChunkIndex: details.nextChunkIndex,
              totalChunks: details.totalChunks,
            };
            setResumeReady(true);
            onResumableUploadChange?.({
              sessionId: details.sessionId,
              uploadedCount,
              totalCount: details.totalChunks,
              pendingCount,
              message: details.error ?? 'Upload paused',
            });

            setUploadError(details.error ?? 'Upload paused');
            setUploadSuccess(null);
            setSelection([videoFile]);
            return;
          }
          throw err;
        }
      }

      clearResumableState();
      onItemsCommitted?.();
      onPendingFilesChange?.([]);

      setUploadSuccess(`Upload complete: ${filesToUpload.length} item${filesToUpload.length === 1 ? '' : 's'} uploaded.`);
      setSelection([]);

      // Briefly flash the success state, then dismiss the modal.
      window.setTimeout(() => onClose(), UPLOAD_SUCCESS_DISMISS_MS);
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setUploadError(apiErr?.error ?? 'Upload failed');
      clearResumableState();
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitFiles(files);
  };

  return (
    <Modal
      title={
        <>
          Upload to <span className="modal__title-accent">{space.spacename}</span>
        </>
      }
      onClose={onClose}
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="modal__upload-form">
        <div className="modal__dropzone" onClick={() => inputRef.current?.click()}>
          {previews.length === 0 ? (
            <>
              <div className="modal__dropzone-icon">📷</div>
              <p className="modal__dropzone-hint">Click to select photos or videos</p>
            </>
          ) : (
            <div className="modal__previews">
              {previews.map((preview, index) => (
                <div key={index} className="modal__preview-wrap">
                  {preview.kind === 'video' ? (
                    <video src={preview.url} className="modal__preview-img" muted playsInline />
                  ) : (
                    <img src={preview.url} alt="" className="modal__preview-img" />
                  )}
                  <button
                    type="button"
                    className="modal__preview-remove"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleRemove(index);
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div
                className="modal__preview-add"
                onClick={(event) => {
                  event.stopPropagation();
                  inputRef.current?.click();
                }}
              >
                + Add more
              </div>
            </div>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*,.heic,.heif"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <button
          type="submit"
          className="modal__btn modal__btn--primary modal__btn--full"
          disabled={uploading || files.length === 0}
        >
          {uploading
            ? 'Uploading…'
            : resumeReady
              ? `Resume ${files.length > 0 ? `${files.length} Item${files.length > 1 ? 's' : ''}` : 'Items'}`
              : `Upload ${files.length > 0 ? `${files.length} Item${files.length > 1 ? 's' : ''}` : 'Items'}`}
        </button>
        {uploadError && <p className="modal__error">{uploadError}</p>}
        {uploadSuccess && <p className="modal__success">{uploadSuccess}</p>}
      </form>
    </Modal>
  );
}