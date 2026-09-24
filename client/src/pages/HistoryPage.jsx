import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { AiStatusBadge } from '../components/Badges.jsx';
import { LoadingState, ErrorAlert, EmptyState } from '../components/Feedback.jsx';
import { api, getErrorMessage } from '../services/api.js';
import { useFetch } from '../hooks/useFetch.js';
import { LANGUAGES, languageLabel } from '../utils/languages.js';
import { formatDateTime, truncate, scoreColor } from '../utils/format.js';

export default function HistoryPage() {
  const { data, loading, error, reload, setData } = useFetch(() => api.listReviews({ limit: 100 }), []);
  const [search, setSearch] = useState('');
  const [language, setLanguage] = useState('all');
  const [deleteError, setDeleteError] = useState('');

  const reviews = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.reviews ?? []).filter((review) => (language === 'all' || review.language === language)
      && (!term || `${review.summary} ${review.codePreview} #${review.id}`.toLowerCase().includes(term)));
  }, [data, search, language]);

  async function remove(review) {
    if (!window.confirm(`Delete review #${review.id}? This cannot be undone.`)) return;
    setDeleteError('');
    try {
      await api.deleteReview(review.id);
      setData((current) => ({
        reviews: current.reviews.filter((item) => item.id !== review.id),
        total: current.total - 1,
      }));
    } catch (requestError) {
      setDeleteError(getErrorMessage(requestError));
    }
  }

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1>Review history</h1>
          <p className="muted">{data ? `${data.total} saved review(s)` : 'Previously saved code reviews'}</p>
        </div>
        <Link to="/review/new" className="btn btn-primary"><Icon name="plus" size={16} /> New Review</Link>
      </div>

      <div className="card filters">
        <input
          type="search"
          className="search-input"
          placeholder="Search summaries and code…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search reviews"
        />
        <select value={language} onChange={(event) => setLanguage(event.target.value)} aria-label="Filter by language">
          <option value="all">All languages</option>
          {LANGUAGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </div>

      <ErrorAlert message={deleteError} />
      {loading && <LoadingState message="Loading history…" />}
      {error && <ErrorAlert message={error} onRetry={reload} />}

      {!loading && !error && data?.reviews.length === 0 && (
        <EmptyState
          icon="history"
          title="No reviews yet"
          action={<Link to="/review/new" className="btn btn-primary">Review your first program</Link>}
        >
          Every review you run is saved here automatically.
        </EmptyState>
      )}

      {!loading && !error && data?.reviews.length > 0 && reviews.length === 0 && (
        <EmptyState title="No reviews match your search" />
      )}

      {reviews.length > 0 && (
        <div className="table-wrap card no-pad">
          <table className="table history-table">
            <thead>
              <tr>
                <th>ID</th><th>Language</th><th>Summary</th><th>Issues</th><th>Score</th><th>Analysis</th><th>Date / time</th><th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {reviews.map((review) => (
                <tr key={review.id}>
                  <td data-label="ID">#{review.id}</td>
                  <td data-label="Language"><span className="badge lang-badge">{languageLabel(review.language)}</span></td>
                  <td data-label="Summary" className="summary-cell">
                    <span>{truncate(review.summary, 140)}</span>
                    <code className="code-preview">{truncate(review.codePreview?.split('\n')[0] ?? '', 70)}</code>
                  </td>
                  <td data-label="Issues">{review.issueCount}</td>
                  <td data-label="Score"><strong style={{ color: scoreColor(review.qualityScore) }}>{review.qualityScore ?? '-'}</strong></td>
                  <td data-label="Analysis"><AiStatusBadge status={review.aiStatus} /></td>
                  <td data-label="Date / time">{formatDateTime(review.createdAt)}</td>
                  <td className="row-actions">
                    <Link to={`/reviews/${review.id}`} className="btn btn-secondary btn-small">View</Link>
                    <button type="button" className="btn btn-danger btn-small" onClick={() => remove(review)} aria-label={`Delete review ${review.id}`}>
                      <Icon name="trash" size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
