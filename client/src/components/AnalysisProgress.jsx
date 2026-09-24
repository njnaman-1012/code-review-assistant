import { useEffect, useState } from 'react';
import { Spinner } from './Feedback.jsx';

const PIPELINE = [
  'Validate code',
  'Automated code checks',
  'AI review (logic, issues, improved code)',
  'Re-check improved code',
  'Build the final report',
];

// Shown while a review is running. The request is a single API call, so we
// show the pipeline stages and the elapsed time rather than fake progress.
export default function AnalysisProgress() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="analysis-progress" role="status" aria-live="polite">
      <div className="progress-head">
        <Spinner size={24} />
        <div>
          <strong>Reviewing your code… {seconds}s</strong>
          <p>The automated checks take under a second. The AI review usually takes 1-4 minutes - please keep this page open.</p>
        </div>
      </div>
      <ol className="pipeline-list">
        {PIPELINE.map((step) => <li key={step}>{step}</li>)}
      </ol>
    </div>
  );
}
