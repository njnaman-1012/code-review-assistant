import { EmptyState } from '../Feedback.jsx';
import { paragraphs } from '../../utils/format.js';

export default function LogicTab({ review }) {
  const { explanation, steps = [], keyComponents = [] } = review.logic ?? {};

  return (
    <div className="panel-stack">
      {explanation ? (
        <section className="card">
          <h2>What the code does</h2>
          {paragraphs(explanation).map((text) => <p key={text}>{text}</p>)}
        </section>
      ) : (
        <EmptyState icon="spark" title="Logic explanation needs the AI engine">
          {review.ai.message || 'The AI analysis was not available for this review.'} The functions detected by static analysis are listed below.
        </EmptyState>
      )}

      {steps.length > 0 && (
        <section className="card">
          <h2>Step-by-step walkthrough</h2>
          <ol className="steps">
            {steps.map((step, index) => <li key={`${index}-${step.slice(0, 20)}`}>{step}</li>)}
          </ol>
        </section>
      )}

      {keyComponents.length > 0 && (
        <section className="card">
          <h2>Key components</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Kind</th><th>Description</th></tr></thead>
              <tbody>
                {keyComponents.map((component) => (
                  <tr key={`${component.kind}-${component.name}`}>
                    <td><code>{component.name}</code></td>
                    <td>{component.kind}</td>
                    <td>{component.description}</td>
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
