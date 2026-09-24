// Loading, empty and error states used across all pages.
import Icon from './Icon.jsx';

export function Spinner({ size = 20 }) {
  return <span className="spinner" style={{ width: size, height: size }} role="status" aria-label="Loading" />;
}

export function LoadingState({ message = 'Loading…' }) {
  return (
    <div className="state-box">
      <Spinner size={28} />
      <p>{message}</p>
    </div>
  );
}

export function EmptyState({ icon = 'info', title, children, action }) {
  return (
    <div className="state-box empty">
      <Icon name={icon} size={30} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorAlert({ message, onRetry }) {
  if (!message) return null;
  return (
    <div className="alert alert-error" role="alert">
      <Icon name="alert" />
      <div className="alert-body">{message}</div>
      {onRetry && <button type="button" className="btn btn-small btn-secondary" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Alert({ type = 'info', icon = 'info', children }) {
  return (
    <div className={`alert alert-${type}`} role={type === 'warning' ? 'alert' : 'status'}>
      <Icon name={icon} />
      <div className="alert-body">{children}</div>
    </div>
  );
}
