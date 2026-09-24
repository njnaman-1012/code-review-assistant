import { paragraphs } from '../../utils/format.js';

export default function ComplexityTab({ review }) {
  const { complexity, staticAnalysis } = review;
  const functions = staticAnalysis.metrics?.functions ?? [];

  return (
    <div className="panel-stack">
      <section className="card">
        <h2>Time and space complexity (Big-O)</h2>
        <p className="muted small">Estimated by the AI engine by reading the code. Values it cannot determine reliably are marked as such instead of being guessed.</p>
        <div className="table-wrap">
          <table className="table complexity-table">
            <thead><tr><th /><th>Time complexity</th><th>Space complexity</th></tr></thead>
            <tbody>
              <tr><th>Original code</th><td><code>{complexity.originalTime}</code></td><td><code>{complexity.originalSpace}</code></td></tr>
              <tr><th>Improved code</th><td><code>{complexity.improvedTime}</code></td><td><code>{complexity.improvedSpace}</code></td></tr>
            </tbody>
          </table>
        </div>
        {paragraphs(complexity.explanation).map((text) => <p key={text}>{text}</p>)}
      </section>

      <section className="card">
        <h2>Cyclomatic complexity (static analysis)</h2>
        <p className="muted small">
          Measured deterministically: 1 + the number of decision points (if, loops, case, catch, &amp;&amp;, ||).
          McCabe recommends keeping each function at 10 or below.
        </p>
        {functions.length === 0 ? <p className="muted">No functions were detected.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Function</th><th>Lines</th><th>Cyclomatic complexity</th><th>Risk</th></tr></thead>
              <tbody>
                {functions.map((fn) => {
                  const risk = fn.cyclomatic > 20 ? 'High' : fn.cyclomatic > 10 ? 'Moderate' : 'Low';
                  return (
                    <tr key={`${fn.name}-${fn.startLine}`}>
                      <td><code>{fn.name}</code></td>
                      <td>{fn.startLine}-{fn.endLine}</td>
                      <td>{fn.cyclomatic}</td>
                      <td className={risk === 'Low' ? 'text-success' : 'text-danger'}>{risk}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
