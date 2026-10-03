import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { AiStatusBadge } from '../components/Badges.jsx';
import TokenUsage from '../components/TokenUsage.jsx';
import { LoadingState, ErrorAlert } from '../components/Feedback.jsx';
import { api } from '../services/api.js';
import { useFetch } from '../hooks/useFetch.js';
import { languageLabel } from '../utils/languages.js';
import { formatDateTime, truncate, scoreColor } from '../utils/format.js';

const WORKFLOW = [
  ['Enter / upload code', 'Paste code, type it, or upload a source file.'],
  ['Validate', 'Empty input, unsupported languages and oversized files are rejected.'],
  ['Automated checks', 'Syntax errors, risky patterns, code smells and complexity are detected.'],
  ['AI review', 'The AI explains the logic, finds deeper issues and writes improved code.'],
  ['Compare & re-check', 'The improved code is checked again with the same automated checks.'],
  ['Final report', 'Everything is saved to history and can be downloaded as a report.'],
];

function ServiceStatus() {
  const { data, loading, error, reload } = useFetch(() => api.getHealth(), []);
  if (loading) return <LoadingState message="Checking service…" />;
  if (error) return <ErrorAlert message={error} onRetry={reload} />;
  const online = data.status === 'ok';
  return (
    <ul className="status-list">
      <li><span className={`dot ${online ? 'ok' : 'bad'}`} /> Service: <strong>{online ? 'Online' : 'Limited'}</strong></li>
      <li>
        <span className={`dot ${data.ai.available ? 'ok' : 'warn'}`} /> AI review:{' '}
        <strong>{data.ai.available ? 'Available' : 'Temporarily unavailable'}</strong>
      </li>
      <li><span className="dot ok" /> Supported languages: <strong>{data.languages.map((l) => l.label).join(', ')}</strong></li>
    </ul>
  );
}

export default function DashboardPage() {
  const { data, loading, error, reload } = useFetch(() => api.listReviews({ limit: 100 }), []);
  const reviews = data?.reviews ?? [];
  const scored = reviews.filter((review) => review.qualityScore !== null);
  const averageScore = scored.length ? Math.round(scored.reduce((sum, r) => sum + r.qualityScore, 0) / scored.length) : null;
  const totalIssues = reviews.reduce((sum, review) => sum + review.issueCount, 0);

  return (
    <div className="container page">
      <section className="hero">
        <div>
          <p className="eyebrow">AI-assisted Code Review Assistant</p>
          <h1>Understand, review and improve your code.</h1>
          <p className="hero-text">
            Submit Python, Java, C++ or JavaScript code and get a structured review: what the code does, the issues it has
            (with severity, line and fix), an improved version, an explanation of every change and a complexity analysis.
          </p>
          <div className="button-row">
            <Link to="/review/new" className="btn btn-primary btn-large"><Icon name="spark" /> Start a new review</Link>
            <Link to="/history" className="btn btn-secondary btn-large"><Icon name="history" /> View history</Link>
          </div>
        </div>
        <div className="card hero-card">
          <h2>Service status</h2>
          <ServiceStatus />
        </div>
      </section>

      <TokenUsage />

      <div className="stat-grid">
        <div className="stat"><span className="stat-label">Reviews saved</span><strong className="stat-value">{data?.total ?? '-'}</strong></div>
        <div className="stat"><span className="stat-label">Average quality score</span><strong className="stat-value">{averageScore ?? '-'}</strong></div>
        <div className="stat"><span className="stat-label">Issues detected</span><strong className="stat-value">{totalIssues}</strong><span className="stat-hint">across the last {reviews.length} reviews</span></div>
      </div>

      <div className="two-col">
        <section className="card">
          <div className="card-head">
            <h2>Recent reviews</h2>
            <Link to="/history" className="link">See all</Link>
          </div>
          {loading && <LoadingState />}
          {error && <ErrorAlert message={error} onRetry={reload} />}
          {!loading && !error && reviews.length === 0 && <p className="muted">No reviews yet - start your first one!</p>}
          <ul className="recent-list">
            {reviews.slice(0, 5).map((review) => (
              <li key={review.id}>
                <Link to={`/reviews/${review.id}`}>
                  <span className="recent-top">
                    <strong>#{review.id} · {languageLabel(review.language)}</strong>
                    <span style={{ color: scoreColor(review.qualityScore) }}>{review.qualityScore ?? '-'}/100</span>
                  </span>
                  <span className="muted small">{truncate(review.summary, 110)}</span>
                  <span className="recent-meta">
                    <AiStatusBadge status={review.aiStatus} />
                    <span className="muted small">{review.issueCount} issues · {formatDateTime(review.createdAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2>How it works</h2>
          <ol className="workflow">
            {WORKFLOW.map(([title, text]) => (
              <li key={title}><strong>{title}</strong><span>{text}</span></li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
