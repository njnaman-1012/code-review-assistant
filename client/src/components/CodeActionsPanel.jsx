// "What do you want to do?" - the two code actions offered after a review.
// Both return the COMPLETE source file (shown in the "Fix & Improve" tab).
import Icon from './Icon.jsx';
import { Spinner, ErrorAlert } from './Feedback.jsx';
import { formatDateTime } from '../utils/format.js';

export const CODE_ACTIONS = [
  {
    id: 'correct',
    label: 'Fix / Correct Code',
    resultLabel: 'Corrected Code',
    icon: 'check',
    buttonClass: 'btn btn-primary',
    description: 'Fix the issues identified during the code review and return the complete corrected code.',
  },
  {
    id: 'improve',
    label: 'Improve Code',
    resultLabel: 'Improved Code',
    icon: 'spark',
    buttonClass: 'btn btn-accent',
    description: 'Improve readability, efficiency, structure and best practices while preserving functionality.',
  },
];

export default function CodeActionsPanel({ codeActions, running, error, onRun, onView }) {
  return (
    <section className="card code-actions" aria-labelledby="code-actions-title">
      <p className="eyebrow">Code actions</p>
      <h2 id="code-actions-title">What do you want to do?</h2>
      <div className="code-action-options">
        {CODE_ACTIONS.map((option) => {
          const result = codeActions[option.id];
          const isRunning = running === option.id;
          return (
            <div key={option.id} className="code-action-option">
              <button
                type="button"
                className={option.buttonClass}
                onClick={() => onRun(option.id)}
                disabled={Boolean(running)}
                aria-busy={isRunning}
              >
                {isRunning ? <Spinner size={16} /> : <Icon name={option.icon} size={18} />}
                {option.label}
              </button>
              <p className="muted small">{option.description}</p>
              {result && !isRunning && (
                <p className="small">
                  <button type="button" className="link-button" onClick={() => onView(option.id)}>
                    View {option.resultLabel.toLowerCase()}
                  </button>
                  <span className="muted"> · generated {formatDateTime(result.generatedAt)} · click the button to generate again</span>
                </p>
              )}
            </div>
          );
        })}
      </div>

      {running && (
        <div className="code-action-running" role="status" aria-live="polite">
          <Spinner size={18} />
          <div>
            <strong>Analyzing and generating complete code…</strong>
            <p className="muted small">This usually takes 1-4 minutes. You can keep reading the review in the meantime.</p>
          </div>
        </div>
      )}
      <ErrorAlert message={error} />
    </section>
  );
}
