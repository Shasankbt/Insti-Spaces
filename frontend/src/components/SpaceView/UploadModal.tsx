import { useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import { checkSpaceItemHashes, uploadToSpace } from '../../Api';
import type { Space } from '../../types';

interface MediaPreview {
  url: string;
  kind: 'image' | 'video';
}

interface UploadModalProps {
  space: Space;
  token: string;
  folderId?: number | null;
  onClose: () => void;
  onUploadSuccess?: () => void;
}

const computeSha256Hex = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

export default function UploadModal({ space, token, folderId, onClose, onUploadSuccess }: UploadModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<MediaPreview[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      previews.forEach((preview) => URL.revokeObjectURL(preview.url));
    },
    [previews],
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    previews.forEach((preview) => URL.revokeObjectURL(preview.url));
    setFiles(selected);
    setPreviews(
      selected.map((file) => ({
        url: URL.createObjectURL(file),
        kind: file.type.startsWith('video/') ? 'video' : 'image',
      })),
    );
    setUploadError(null);
    setUploadSuccess(null);
  };

  const handleRemove = (index: number) => {
    setFiles((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
    setPreviews((prev) => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.url);
      return prev.filter((_, currentIndex) => currentIndex !== index);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!files.length) return;

    setUploadError(null);
    setUploadSuccess(null);
    try {
      setUploading(true);
      const fileHashes = await Promise.all(files.map((file) => computeSha256Hex(file)));

      let existingHashes = new Set<string>();
      try {
        const { data } = await checkSpaceItemHashes({
          spaceId: space.id,
          hashes: fileHashes,
          token,
        });
        existingHashes = new Set(data.existingHashes ?? []);
      } catch {
        existingHashes = new Set<string>();
      }

      const filesToUpload: File[] = [];
      const hashesToUpload: string[] = [];
      for (let index = 0; index < files.length; index += 1) {
        const hash = fileHashes[index];
        if (!existingHashes.has(hash)) {
          filesToUpload.push(files[index]);
          hashesToUpload.push(hash);
        }
      }

      const duplicateCount = files.length - filesToUpload.length;

      if (filesToUpload.length > 0) {
        const formData = new FormData();
        filesToUpload.forEach((file) => formData.append('items', file));
        formData.append('content_hashes', JSON.stringify(hashesToUpload));
        if (folderId != null) formData.append('folder_id', String(folderId));
        await uploadToSpace({ spaceId: space.id, formData, token });
        onUploadSuccess?.();
      }

      setUploadSuccess(
        `Upload complete: ${filesToUpload.length} uploaded, ${duplicateCount} duplicate${duplicateCount === 1 ? '' : 's'} skipped.`,
      );
      setFiles([]);
      previews.forEach((preview) => URL.revokeObjectURL(preview.url));
      setPreviews([]);
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setUploadError(apiErr?.error ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
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
          accept="image/*,video/*"
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
            : `Upload ${files.length > 0 ? `${files.length} Item${files.length > 1 ? 's' : ''}` : 'Items'}`}
        </button>
        {uploadError && <p className="modal__error">{uploadError}</p>}
        {uploadSuccess && <p className="modal__success">{uploadSuccess}</p>}
      </form>
    </Modal>
  );
}