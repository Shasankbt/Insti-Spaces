export default function Modal({ title, onClose, children }) {
  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose();
  };
  return (
    <div className="modal-backdrop" onClick={handleBackdrop}>
      <div className="modal">
        <div className="modal__header">
          <span className="modal__title">{title}</span>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}
