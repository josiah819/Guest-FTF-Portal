import React, { useCallback, useEffect, useRef, useState } from 'react';

// One styled confirmation for every destructive action — replaces the browser's
// window.confirm. Use the hook:
//
//   const { confirm, confirmElement } = useConfirm();
//   ...
//   if (!await confirm({ title: 'Delete “Cabin 11”?', message: '…', confirmLabel: 'Delete location' })) return;
//   ...
//   return <>{confirmElement}…</>

function ConfirmDialog({ title, message, confirmLabel = 'Delete', cancelLabel = 'Cancel', onClose }) {
  const cancelRef = useRef(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose(false)}>
      <div className="modal-card" role="alertdialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="modal-actions">
          <button ref={cancelRef} className="btn btn-ghost btn-small" onClick={() => onClose(false)}>
            {cancelLabel}
          </button>
          <button className="btn btn-danger btn-small" onClick={() => onClose(true)}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useConfirm() {
  const [opts, setOpts] = useState(null);
  const resolver = useRef(null);

  const confirm = useCallback((o) => new Promise(resolve => {
    resolver.current = resolve;
    setOpts(o);
  }), []);

  const close = useCallback((answer) => {
    resolver.current?.(answer);
    resolver.current = null;
    setOpts(null);
  }, []);

  return {
    confirm,
    confirmElement: opts ? <ConfirmDialog {...opts} onClose={close} /> : null,
  };
}
