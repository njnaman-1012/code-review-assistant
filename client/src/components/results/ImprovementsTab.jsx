import { EmptyState } from '../Feedback.jsx';

const SUMMARY_FIELDS = [
  ['performance', 'Did performance improve?'],
  ['readability', 'Did readability improve?'],
  ['complexity', 'Did complexity change?'],
  ['security', 'Were security issues fixed?'],
];

export default function ImprovementsTab({ review }) {
  const { changes = [], summary } = review.improvements ?? {};

  if (!changes.length && !summary) {
    return <EmptyState icon="spark" title="No improvement explanation">This section is produced by the AI engine. {review.ai.message}</EmptyState>;
  }

  return (
    <div className="panel-stack">
      {summary && (
        <div className="summary-grid">
          {SUMMARY_FIELDS.map(([key, question]) => (
            <section className="card" key={key}>
              <h3>{question}</h3>
              <p>{summary[key] || 'Not stated.'}</p>
            </section>
          ))}
        </div>
      )}

      {changes.map((change, index) => (
        <section className="card change-card" key={`${index}-${change.change}`}>
          <h2><span className="suggestion-number">{index + 1}</span>{change.change}</h2>
          <div className="change-compare">
            <div className="change-before">
              <span className="change-label">Original approach</span>
              <p>{change.original || '-'}</p>
            </div>
            <div className="change-after">
              <span className="change-label">Improved approach</span>
              <p>{change.improved || '-'}</p>
            </div>
          </div>
          <dl className="issue-details">
            <div><dt>Why it was changed</dt><dd>{change.reason || '-'}</dd></div>
            <div className="issue-fix"><dt>Problem solved / benefit</dt><dd>{change.benefit || '-'}</dd></div>
          </dl>
        </section>
      ))}
    </div>
  );
}
