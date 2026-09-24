// Colored labels for severity, issue source, confidence and AI status.

export function SeverityBadge({ severity }) {
  return <span className={`badge sev-${severity.toLowerCase()}`}>{severity}</span>;
}

export function SourceBadge({ source }) {
  return source === 'static'
    ? <span className="badge source-static" title="Found by deterministic static analysis">Static analysis</span>
    : <span className="badge source-ai" title="Found by the AI review engine">AI analysis</span>;
}

const CONFIDENCE_TEXT = {
  confirmed: 'Confirmed',
  likely: 'Likely',
  possible: 'Possible',
};

export function ConfidenceBadge({ confidence }) {
  return <span className={`badge conf-${confidence}`}>{CONFIDENCE_TEXT[confidence] ?? confidence}</span>;
}

export function TypeBadge({ type }) {
  return <span className="badge type-badge">{type}</span>;
}

const AI_STATUS = {
  completed: { label: 'Full review', className: 'status-ok' },
  unavailable: { label: 'Checks only', className: 'status-warn' },
  failed: { label: 'Checks only', className: 'status-warn' },
};

export function AiStatusBadge({ status }) {
  const info = AI_STATUS[status] ?? { label: status, className: '' };
  return <span className={`badge ${info.className}`}>{info.label}</span>;
}

export function PriorityBadge({ priority }) {
  return <span className={`badge prio-${priority}`}>{priority} priority</span>;
}
