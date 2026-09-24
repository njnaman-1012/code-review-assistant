import { useMemo, useState } from 'react';
import IssueCard from '../IssueCard.jsx';
import { EmptyState } from '../Feedback.jsx';
import { SEVERITIES } from '../../utils/format.js';

export default function IssuesTab({ review }) {
  const [severity, setSeverity] = useState('ALL');
  const [source, setSource] = useState('all');
  const [type, setType] = useState('all');

  const types = useMemo(() => [...new Set(review.issues.map((issue) => issue.type))].sort(), [review.issues]);

  const filtered = review.issues.filter((issue) => (severity === 'ALL' || issue.severity === severity)
    && (source === 'all' || issue.source === source)
    && (type === 'all' || issue.type === type));

  if (review.issues.length === 0) {
    return <EmptyState icon="check" title="No issues found">Neither static analysis nor the AI review found problems in this code.</EmptyState>;
  }

  return (
    <div className="panel-stack">
      <div className="filters card">
        <div className="chip-group" role="group" aria-label="Filter by severity">
          {['ALL', ...SEVERITIES].map((value) => (
            <button
              key={value}
              type="button"
              className={`chip${severity === value ? ' active' : ''}`}
              onClick={() => setSeverity(value)}
            >
              {value === 'ALL' ? 'All' : value} ({value === 'ALL' ? review.issues.length : review.issues.filter((i) => i.severity === value).length})
            </button>
          ))}
        </div>
        <div className="filter-selects">
          <label>
            Source
            <select value={source} onChange={(event) => setSource(event.target.value)}>
              <option value="all">All sources</option>
              <option value="static">Static analysis</option>
              <option value="ai">AI analysis</option>
            </select>
          </label>
          <label>
            Type
            <select value={type} onChange={(event) => setType(event.target.value)}>
              <option value="all">All types</option>
              {types.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </div>
      </div>

      <p className="muted small">
        <strong>Static analysis</strong> issues come from the parser and rule checks and are repeatable.{' '}
        <strong>AI analysis</strong> issues are the AI&apos;s judgement - check the confidence label.
      </p>

      {filtered.length === 0
        ? <EmptyState title="No issues match these filters" />
        : filtered.map((issue) => <IssueCard key={issue.id} issue={issue} />)}
    </div>
  );
}
