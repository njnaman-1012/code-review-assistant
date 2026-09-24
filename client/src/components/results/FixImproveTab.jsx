// The complete corrected / improved code: Monaco viewer, copy and download,
// the list of changes, and a comparison with the original code.
import { useState } from 'react';
import { CodeViewer, DiffViewer } from '../CodeEditor.jsx';
import CopyButton from '../CopyButton.jsx';
import Icon from '../Icon.jsx';
import { EmptyState, LoadingState, Alert } from '../Feedback.jsx';
import { CODE_ACTIONS } from '../CodeActionsPanel.jsx';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import { getLanguage, languageLabel } from '../../utils/languages.js';
import { downloadTextFile } from '../../utils/fileUtils.js';
import { formatDateTime } from '../../utils/format.js';

function Segmented({ label, options, value, onChange }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([id, text]) => (
        <button key={id} type="button" className={value === id ? 'active' : ''} aria-pressed={value === id} onClick={() => onChange(id)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function CheckBadges({ checks }) {
  if (!checks?.syntaxValid) return null;
  return (
    <div className="check-badges">
      <span className="badge status-ok"><Icon name="check" size={12} /> Complete file · {checks.totalLines} lines (original {checks.originalTotalLines ?? '?'})</span>
      <span className="badge status-ok"><Icon name="check" size={12} /> Syntax valid</span>
      <span className="badge">
        Static-analysis issues: {checks.staticIssueCount}
        {checks.originalStaticIssueCount !== null && checks.originalStaticIssueCount !== undefined && ` (original ${checks.originalStaticIssueCount})`}
      </span>
    </div>
  );
}

export default function FixImproveTab({ review, codeActions, selected, onSelect, running, onRun }) {
  const [view, setView] = useState('code');
  const wide = useMediaQuery('(min-width: 900px)');
  const available = CODE_ACTIONS.filter((option) => codeActions[option.id]);

  if (!available.length) {
    if (running) return <LoadingState message="Analyzing and generating complete code…" />;
    return (
      <EmptyState
        icon="spark"
        title="No corrected or improved code yet"
        action={(
          <div className="button-row">
            {CODE_ACTIONS.map((option) => (
              <button key={option.id} type="button" className={option.buttonClass} onClick={() => onRun(option.id)} disabled={Boolean(running)}>
                <Icon name={option.icon} size={18} /> {option.label}
              </button>
            ))}
          </div>
        )}
      >
        Choose Fix / Correct Code to fix the problems found in this review, or Improve Code for a cleaner and more
        efficient version. Both return the complete source file.
      </EmptyState>
    );
  }

  const option = available.find((item) => item.id === selected) ?? available[0];
  const result = codeActions[option.id];
  const extension = getLanguage(review.language)?.fileExtension ?? 'txt';
  const filename = `${option.id === 'correct' ? 'corrected' : 'improved'}_code_review_${review.id}.${extension}`;
  const views = [
    ['code', option.resultLabel],
    ['original', 'Original Code'],
    ['diff', `Original → ${option.id === 'correct' ? 'Corrected' : 'Improved'} (diff)`],
  ];

  return (
    <div className="panel-stack">
      {available.length > 1 && (
        <Segmented
          label="Generated version"
          options={available.map((item) => [item.id, item.resultLabel])}
          value={option.id}
          onChange={onSelect}
        />
      )}
      {running && <Alert type="info" icon="info">Generating new code… The version below is replaced when it is ready.</Alert>}

      <section className="card toolbar-card">
        <div>
          <p className="eyebrow">{option.resultLabel}</p>
          <h2>Complete {languageLabel(review.language)} source file</h2>
          <p className="muted small">Generated {formatDateTime(result.generatedAt)}. {result.summary}</p>
          <CheckBadges checks={result.checks} />
        </div>
        <div className="button-row">
          <CopyButton text={result.code} label="Copy Code" className="btn btn-primary btn-small" />
          <button type="button" className="btn btn-secondary btn-small" onClick={() => downloadTextFile(result.code, filename)}>
            <Icon name="download" size={16} /> Download Code
          </button>
        </div>
      </section>

      <Segmented label="Code view" options={views} value={view} onChange={setView} />
      {view === 'code' && <CodeViewer code={result.code} language={review.language} maxHeight={720} />}
      {view === 'original' && <CodeViewer code={review.originalCode} language={review.language} maxHeight={720} />}
      {view === 'diff' && (
        <>
          <div className="diff-labels">
            <span>Original code</span>
            {wide && <span>{option.resultLabel}</span>}
          </div>
          <DiffViewer original={review.originalCode} modified={result.code} language={review.language} sideBySide={wide} />
        </>
      )}

      <section className="card">
        <h2>What was changed?</h2>
        {result.changes.length ? (
          <ul className="change-list">
            {result.changes.map((change, index) => (
              <li key={`${index}-${change.title}`} title={[change.explanation, change.problemSolved].filter(Boolean).join(' ') || undefined}>
                <Icon name="check" size={14} />
                <span>{change.title}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">The AI did not list the individual changes. Use the diff view to see them.</p>
        )}
        <p className="muted small">
          The code was re-checked by the static analyzer but has not been executed. Test it before relying on it.
        </p>
      </section>
    </div>
  );
}
