import { SeverityBadge, SourceBadge, ConfidenceBadge, TypeBadge } from './Badges.jsx';

// Shows every field of one detected issue.
export default function IssueCard({ issue }) {
  return (
    <article className={`issue-card sev-border-${issue.severity.toLowerCase()}`}>
      <header className="issue-head">
        <div className="issue-badges">
          <SeverityBadge severity={issue.severity} />
          <TypeBadge type={issue.type} />
          <SourceBadge source={issue.source} />
          <ConfidenceBadge confidence={issue.confidence} />
        </div>
        <span className="issue-line">{issue.line ? `Line ${issue.line}` : 'General'}</span>
      </header>

      <h3 className="issue-title">{issue.title}</h3>

      {issue.code && <pre className="issue-code"><code>{issue.code}</code></pre>}

      <dl className="issue-details">
        <div>
          <dt>Explanation</dt>
          <dd>{issue.explanation || '-'}</dd>
        </div>
        <div>
          <dt>Why it matters</dt>
          <dd>{issue.impact || '-'}</dd>
        </div>
        <div className="issue-fix">
          <dt>Recommended fix</dt>
          <dd>{issue.suggestion || '-'}</dd>
        </div>
      </dl>
      <footer className="issue-meta">{issue.id}</footer>
    </article>
  );
}
