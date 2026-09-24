import Icon from '../Icon.jsx';
import { paragraphs } from '../../utils/format.js';

const REPORT_SECTIONS = [
  'Original Code', 'Code Summary', 'Logic Explanation', 'Issues Detected', 'Suggestions',
  'Improved Code', 'Explanation of Improvements', 'Complexity Analysis', 'Original vs Improved', 'Final Summary',
];

export default function ReportTab({ review, onDownload, onPrint, busy }) {
  return (
    <div className="panel-stack">
      <section className="card">
        <h2>Final summary</h2>
        {paragraphs(review.finalSummary).map((text) => <p key={text}>{text}</p>)}
      </section>

      <section className="card">
        <h2>Download review report</h2>
        <p>The report contains the project title, language, date/time and these sections, in this order:</p>
        <ol className="report-sections">
          {REPORT_SECTIONS.map((section) => <li key={section}>{section}</li>)}
        </ol>
        <div className="button-row">
          <button type="button" className="btn btn-primary" onClick={() => onDownload('html')} disabled={busy}>
            <Icon name="download" size={16} /> Download Review Report (HTML)
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => onDownload('md')} disabled={busy}>
            <Icon name="file" size={16} /> Download as Markdown
          </button>
          <button type="button" className="btn btn-secondary" onClick={onPrint} disabled={busy}>
            <Icon name="print" size={16} /> Print / Save as PDF
          </button>
        </div>
        <p className="muted small">Tip: to get a PDF, choose &quot;Print / Save as PDF&quot; and select &quot;Save as PDF&quot; as the printer.</p>
      </section>
    </div>
  );
}
