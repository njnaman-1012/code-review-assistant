import { SeverityBadge } from '../Badges.jsx';
import QualityScore from '../QualityScore.jsx';
import { SEVERITIES, paragraphs } from '../../utils/format.js';

function Stat({ label, value, hint }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export default function OverviewTab({ review, onSelectTab }) {
  const { quality, staticAnalysis, issues, ai } = review;
  const metrics = staticAnalysis.metrics ?? {};
  const counts = quality.counts ?? { bySeverity: {}, bySource: {} };
  const maxCount = Math.max(1, ...SEVERITIES.map((s) => counts.bySeverity[s] ?? 0));

  return (
    <div className="panel-stack">
      <section className="card overview-summary">
        <QualityScore score={quality.score} grade={quality.grade} size={110} />
        <div>
          <h2>Summary</h2>
          {paragraphs(review.summary).map((text) => <p key={text}>{text}</p>)}
        </div>
      </section>

      <div className="stat-grid">
        <Stat label="Issues found" value={issues.length} hint={`${counts.bySource.static ?? 0} static · ${counts.bySource.ai ?? 0} AI`} />
        <Stat label="Lines of code" value={metrics.codeLines ?? '-'} hint={`${metrics.totalLines ?? '-'} lines in total`} />
        <Stat label="Functions" value={metrics.functionCount ?? '-'} hint={`${metrics.classCount ?? 0} class(es)`} />
        <Stat label="Max cyclomatic complexity" value={metrics.maxCyclomatic ?? '-'} hint="McCabe metric (≤ 10 recommended)" />
        <Stat label="Syntax" value={staticAnalysis.syntaxValid ? 'Valid' : 'Errors'} hint="checked by the parser" />
        <Stat label="AI quality score" value={quality.aiScore ?? '-'} hint="the AI's own opinion" />
      </div>

      <div className="two-col">
        <section className="card">
          <h2>Issues by severity</h2>
          <div className="severity-bars">
            {SEVERITIES.map((severity) => (
              <div className="severity-row" key={severity}>
                <SeverityBadge severity={severity} />
                <div className="bar-track">
                  <div className={`bar-fill sev-bg-${severity.toLowerCase()}`} style={{ width: `${((counts.bySeverity[severity] ?? 0) / maxCount) * 100}%` }} />
                </div>
                <span className="bar-count">{counts.bySeverity[severity] ?? 0}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <h2>Review status</h2>
          <ul className="plain-list">
            <li><strong>Automated code checks:</strong> completed ({plural(counts.bySource.static ?? 0, 'issue')} found)</li>
            <li>
              <strong>AI review:</strong>{' '}
              {ai.status === 'completed'
                ? `completed (${plural(counts.bySource.ai ?? 0, 'additional issue')} found)`
                : 'not available for this review'}
            </li>
            <li>Both results were combined, duplicates removed and the issues ranked by severity.</li>
          </ul>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Most important issues</h2>
          {issues.length > 0 && (
            <button type="button" className="btn btn-secondary btn-small" onClick={() => onSelectTab('issues')}>
              View all {issues.length} issues
            </button>
          )}
        </div>
        {issues.length === 0 ? (
          <p className="muted">No issues were detected.</p>
        ) : (
          <ul className="top-issues">
            {issues.slice(0, 5).map((issue) => (
              <li key={issue.id}>
                <SeverityBadge severity={issue.severity} />
                <span className="top-issue-title">{issue.title}</span>
                <span className="muted">{issue.line ? `line ${issue.line}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
