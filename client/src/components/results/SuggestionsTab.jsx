import { PriorityBadge } from '../Badges.jsx';
import { EmptyState } from '../Feedback.jsx';

export default function SuggestionsTab({ review }) {
  if (!review.suggestions.length) {
    return <EmptyState icon="check" title="No suggestions">There is nothing to suggest for this code.</EmptyState>;
  }
  return (
    <div className="panel-stack">
      {review.ai.status !== 'completed' && (
        <p className="muted small">These suggestions come from the static-analysis findings because AI analysis was not available.</p>
      )}
      <ol className="suggestion-list">
        {review.suggestions.map((suggestion, index) => (
          <li key={`${index}-${suggestion.title}`} className="card suggestion">
            <div className="suggestion-head">
              <span className="suggestion-number">{index + 1}</span>
              <h3>{suggestion.title}</h3>
              <PriorityBadge priority={suggestion.priority} />
            </div>
            {suggestion.description && <p>{suggestion.description}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
