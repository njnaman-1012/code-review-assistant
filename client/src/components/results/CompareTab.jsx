import { DiffViewer } from '../CodeEditor.jsx';
import { EmptyState } from '../Feedback.jsx';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';

function Row({ label, original, improved, lowerIsBetter = true }) {
  const better = lowerIsBetter ? improved < original : improved > original;
  const worse = lowerIsBetter ? improved > original : improved < original;
  return (
    <tr>
      <th>{label}</th>
      <td>{String(original)}</td>
      <td className={better ? 'text-success' : worse ? 'text-danger' : ''}>{String(improved)}</td>
    </tr>
  );
}

export default function CompareTab({ review }) {
  const wide = useMediaQuery('(min-width: 900px)');

  if (!review.improvedCode) {
    return <EmptyState icon="layers" title="Nothing to compare">No improved code was generated for this review. {review.ai.message}</EmptyState>;
  }

  const { comparison } = review;
  return (
    <div className="panel-stack">
      <div className="diff-labels">
        <span>Original code</span>
        {wide && <span>Improved code</span>}
      </div>
      <DiffViewer original={review.originalCode} modified={review.improvedCode} language={review.language} sideBySide={wide} />

      {comparison && (
        <section className="card">
          <h2>Measured by the same static analyzer</h2>
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr><th>Metric</th><th>Original</th><th>Improved</th></tr></thead>
              <tbody>
                <tr>
                  <th>Syntax valid</th>
                  <td>{comparison.original.syntaxValid ? 'Yes' : 'No'}</td>
                  <td className={comparison.improved.syntaxValid ? 'text-success' : 'text-danger'}>{comparison.improved.syntaxValid ? 'Yes' : 'No'}</td>
                </tr>
                <Row label="Static-analysis issues" original={comparison.original.staticIssueCount} improved={comparison.improved.staticIssueCount} />
                <Row label="Highest cyclomatic complexity" original={comparison.original.maxCyclomatic} improved={comparison.improved.maxCyclomatic} />
                <Row label="Average cyclomatic complexity" original={comparison.original.averageCyclomatic} improved={comparison.improved.averageCyclomatic} />
                <Row label="Deepest nesting" original={comparison.original.maxNesting} improved={comparison.improved.maxNesting} />
                <tr><th>Lines of code</th><td>{comparison.original.codeLines}</td><td>{comparison.improved.codeLines}</td></tr>
                <tr><th>Functions</th><td>{comparison.original.functionCount}</td><td>{comparison.improved.functionCount}</td></tr>
              </tbody>
            </table>
          </div>
          <ul className="plain-list">
            {comparison.notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
