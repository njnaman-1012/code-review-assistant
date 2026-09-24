import QualityScore from '../QualityScore.jsx';

const CYCLOMATIC_LIMIT = 10;

export default function QualityTab({ review }) {
  const { quality, staticAnalysis, issues } = review;
  const metrics = staticAnalysis.metrics ?? { functions: [] };

  const byType = issues.reduce((acc, issue) => ({ ...acc, [issue.type]: (acc[issue.type] ?? 0) + 1 }), {});

  return (
    <div className="panel-stack">
      <section className="card quality-head">
        <QualityScore score={quality.score} grade={quality.grade} size={120} />
        <div>
          <h2>Code quality score: {quality.score}/100</h2>
          <p>The score is calculated <strong>deterministically</strong> from the detected issues, so the same code always gets the same score:</p>
          <p className="formula">{quality.formula}</p>
          <p className="muted">
            AI&apos;s own quality estimate: <strong>{quality.aiScore ?? 'not available'}</strong>
            {quality.aiScore !== null && quality.aiScore !== undefined ? '/100' : ''} (shown for comparison only).
          </p>
        </div>
      </section>

      <div className="two-col">
        <section className="card">
          <h2>Code metrics (static analysis)</h2>
          <table className="table compact">
            <tbody>
              <tr><th>Total lines</th><td>{metrics.totalLines}</td></tr>
              <tr><th>Code lines</th><td>{metrics.codeLines}</td></tr>
              <tr><th>Comment lines</th><td>{metrics.commentLines}</td></tr>
              <tr><th>Blank lines</th><td>{metrics.blankLines}</td></tr>
              <tr><th>Functions / methods</th><td>{metrics.functionCount}</td></tr>
              <tr><th>Classes</th><td>{metrics.classCount}</td></tr>
              <tr><th>Average cyclomatic complexity</th><td>{metrics.averageCyclomatic}</td></tr>
              <tr><th>Highest cyclomatic complexity</th><td>{metrics.maxCyclomatic}</td></tr>
              <tr><th>Deepest nesting</th><td>{metrics.maxNesting}</td></tr>
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2>Issues by type</h2>
          {Object.keys(byType).length === 0 ? <p className="muted">No issues.</p> : (
            <table className="table compact">
              <tbody>
                {Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                  <tr key={type}><th>{type}</th><td>{count}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {metrics.functions?.length > 0 && (
        <section className="card">
          <h2>Per-function metrics</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Function</th><th>Lines</th><th>Length</th><th>Parameters</th><th>Cyclomatic complexity</th><th>Max nesting</th></tr>
              </thead>
              <tbody>
                {metrics.functions.map((fn) => (
                  <tr key={`${fn.name}-${fn.startLine}`}>
                    <td><code>{fn.name}</code></td>
                    <td>{fn.startLine}-{fn.endLine}</td>
                    <td>{fn.length}</td>
                    <td>{fn.parameters}</td>
                    <td className={fn.cyclomatic > CYCLOMATIC_LIMIT ? 'text-danger' : ''}>{fn.cyclomatic}</td>
                    <td>{fn.maxNesting}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
