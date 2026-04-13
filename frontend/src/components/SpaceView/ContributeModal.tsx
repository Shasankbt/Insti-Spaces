import { useState, useRef } from 'react';
import Modal from './Modal';
import { contributeToSpace } from '../../Api';
import type { Space } from '../../types';

interface ContributeModalProps {
  space: Space;
  token: string;
  onClose: () => void;
}

export default function ContributeModal({ space, token, onClose }: ContributeModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    setFiles(selected);
    setPreviews(selected.map((f) => URL.createObjectURL(f)));
    setUploadError(null);
    setUploadSuccess(null);
  };

  const handleRemove = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    setPreviews((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!files.length) return;
    setUploadError(null);
    setUploadSuccess(null);
    try {
      setUploading(true);
      const formData = new FormData();
      files.forEach((f) => formData.append('photos', f));
      await contributeToSpace({ spaceId: space.id, formData, token });
      setUploadSuccess(`${files.length} photo${files.length > 1 ? 's' : ''} uploaded!`);
      setFiles([]);
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
          Contribute to <span className="modal__title-accent">{space.spacename}</span>
        </>
      }
      onClose={onClose}
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="modal__contribute-form">
        <div className="modal__dropzone" onClick={() => inputRef.current?.click()}>
          {previews.length === 0 ? (
            <>
              <div className="modal__dropzone-icon">📷</div>
              <p className="modal__dropzone-hint">Click to select photos</p>
            </>
          ) : (
            <div className="modal__previews">
              {previews.map((src, i) => (
                <div key={i} className="modal__preview-wrap">
                  <img src={src} alt="" className="modal__preview-img" />
                  <button
                    type="button"
                    className="modal__preview-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemove(i);
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div
                className="modal__preview-add"
                onClick={(e) => {
                  e.stopPropagation();
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
          accept="image/*"
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
            : `Upload ${files.length > 0 ? `${files.length} Photo${files.length > 1 ? 's' : ''}` : 'Photos'}`}
        </button>
        {uploadError && <p className="modal__error">{uploadError}</p>}
        {uploadSuccess && <p className="modal__success">{uploadSuccess}</p>}
      </form>
    </Modal>
  );
}
