import { useEffect, useRef } from 'react';
import Skeleton from '../ui/Skeleton.jsx';
import useCountUp from '../ui/useCountUp.js';

export const Spinner = ({ label = 'Loading' }) => <div className="skel-list" role="status" aria-label={label}><Skeleton height={22} width="40%" /><Skeleton height={80} /><Skeleton height={80} /></div>;
export const Empty = ({ title, hint, children }) => <div className="empty"><strong>{title}</strong>{hint && <p className="small">{hint}</p>}{children}</div>;
export const ErrorBox = ({ message, onRetry }) => <div className="empty" role="alert"><p className="err">{message}</p>{onRetry && <button className="btn sm" onClick={onRetry}>Retry</button>}</div>;
export const Badge = ({ value }) => <span className={`badge b-${value}`}>{value}</span>;
export function Stat({ label, value, hint }) {
  const isInt = typeof value === 'number' && Number.isInteger(value);
  const n = useCountUp(isInt ? value : 0);
  return <div className="glass stat"><div className="v">{isInt ? n : value}</div><div className="l">{label}</div>{hint && <div className="small muted">{hint}</div>}</div>;
}

export function Field({ label, id, error, children, ...props }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children || <input id={id} aria-invalid={!!error} aria-describedby={error ? `${id}-e` : undefined} {...props} />}
      {error && <span id={`${id}-e`} className="err">{error}</span>}
    </div>
  );
}

export function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement; ref.current?.focus();
    const esc = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('keydown', esc); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="glass modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <h2>{title}</h2>{children}
      </div>
    </div>
  );
}

// Confirmation dialog for destructive actions.
export function Confirm({ title, message, confirmLabel = 'Confirm', onConfirm, onClose, busy }) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="muted">{message}</p>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn danger" disabled={busy} onClick={onConfirm}>{busy ? 'Working...' : confirmLabel}</button>
      </div>
    </Modal>
  );
}
