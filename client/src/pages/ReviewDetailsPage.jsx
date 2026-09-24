import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Tabs from '../components/Tabs.jsx';
import Icon from '../components/Icon.jsx';
import { AiStatusBadge, SeverityBadge } from '../components/Badges.jsx';
import { LoadingState, ErrorAlert, Alert, EmptyState } from '../components/Feedback.jsx';
import { CodeViewer } from '../components/CodeEditor.jsx';
import CodeActionsPanel from '../components/CodeActionsPanel.jsx';
import OverviewTab from '../components/results/OverviewTab.jsx';
import LogicTab from '../components/results/LogicTab.jsx';
import IssuesTab from '../components/results/IssuesTab.jsx';
import FixImproveTab from '../components/results/FixImproveTab.jsx';
import QualityTab from '../components/results/QualityTab.jsx';
import SuggestionsTab from '../components/results/SuggestionsTab.jsx';
import ImprovedCodeTab from '../components/results/ImprovedCodeTab.jsx';
import ImprovementsTab from '../components/results/ImprovementsTab.jsx';
import ComplexityTab from '../components/results/ComplexityTab.jsx';
import CompareTab from '../components/results/CompareTab.jsx';
import ReportTab from '../components/results/ReportTab.jsx';
import { api, getErrorMessage } from '../services/api.js';
import { useFetch } from '../hooks/useFetch.js';
import { languageLabel } from '../utils/languages.js';
import { formatDateTime, SEVERITIES } from '../utils/format.js';
import { downloadTextFile } from '../utils/fileUtils.js';

const TAB_IDS = ['overview', 'logic', 'issues', 'fix', 'quality', 'suggestions', 'improved', 'improvements', 'complexity', 'compare', 'report'];

export default function ReviewDetailsPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

  // "Fix / Correct Code" and "Improve Code"
  const [generatedCode, setGeneratedCode] = useState({}); // results generated on this page
  const [runningAction, setRunningAction] = useState(null);
  const [codeActionError, setCodeActionError] = useState('');
  const [selectedAction, setSelectedAction] = useState(null);
  const actionInFlight = useRef(false); // blocks duplicate requests immediately
  const currentId = useRef(id);
  currentId.current = id;
  useEffect(() => {
    setGeneratedCode({});
    setSelectedAction(null);
    setCodeActionError('');
  }, [id]);

  // A freshly created review is passed in navigation state - no second request needed.
  const passedReview = location.state?.review?.id === Number(id) ? location.state.review : null;
  const { data: fetched, loading, error, reload } = useFetch(
    () => (passedReview ? Promise.resolve(passedReview) : api.getReview(id)),
    [id],
  );
  const review = fetched ?? passedReview;

  const activeTab = TAB_IDS.includes(searchParams.get('tab')) ? searchParams.get('tab') : 'overview';
  const selectTab = (tab) => setSearchParams({ tab }, { replace: true });

  function showCodeResult(action) {
    setSelectedAction(action);
    selectTab('fix');
    requestAnimationFrame(() => document.getElementById('tab-fix')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  async function runCodeAction(action) {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    const reviewId = String(review.id);
    setRunningAction(action);
    setCodeActionError('');
    setSelectedAction(action);
    selectTab('fix');
    try {
      const result = await (action === 'correct' ? api.correctCode(review.id) : api.improveCode(review.id));
      if (currentId.current !== reviewId) return; // the user opened another review meanwhile
      setGeneratedCode((previous) => ({ ...previous, [action]: result }));
      showCodeResult(action);
    } catch (requestError) {
      if (currentId.current === reviewId) setCodeActionError(getErrorMessage(requestError));
    } finally {
      actionInFlight.current = false;
      setRunningAction(null);
    }
  }

  async function downloadReport(format) {
    setBusy(true);
    setActionError('');
    try {
      const content = await api.getReport(review.id, format);
      const isHtml = format === 'html';
      downloadTextFile(content, `code-review-${review.id}.${isHtml ? 'html' : 'md'}`, isHtml ? 'text/html' : 'text/markdown');
    } catch (requestError) {
      setActionError(getErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function printReport() {
    // Open the window immediately (inside the click) so pop-up blockers allow it.
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      setActionError('The browser blocked the print window. Allow pop-ups for this site, or download the HTML report instead.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const html = await api.getReport(review.id, 'html');
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 400);
    } catch (requestError) {
      printWindow.close();
      setActionError(getErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function deleteReview() {
    if (!window.confirm(`Delete review #${review.id}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api.deleteReview(review.id);
      navigate('/history', { replace: true });
    } catch (requestError) {
      setActionError(getErrorMessage(requestError));
      setBusy(false);
    }
  }

  if (loading && !review) return <div className="container page"><LoadingState message="Loading review…" /></div>;
  if (error && !review) {
    return (
      <div className="container page">
        <ErrorAlert message={error} onRetry={reload} />
        <Link to="/history" className="btn btn-secondary">Back to history</Link>
      </div>
    );
  }
  if (!review) return <div className="container page"><EmptyState title="Review not found" /></div>;

  const counts = review.quality?.counts?.bySeverity ?? {};
  const codeActions = { correct: null, improve: null, ...review.codeActions, ...generatedCode };
  const generatedCount = Object.values(codeActions).filter(Boolean).length;
  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'logic', label: 'Code Logic' },
    { id: 'issues', label: 'Issues Found', count: review.issues.length },
    { id: 'fix', label: 'Fix & Improve', count: generatedCount || undefined },
    { id: 'quality', label: 'Code Quality' },
    { id: 'suggestions', label: 'Suggestions', count: review.suggestions.length },
    { id: 'improved', label: 'Improved Code' },
    { id: 'improvements', label: 'Explanation of Improvements' },
    { id: 'complexity', label: 'Complexity' },
    { id: 'compare', label: 'Original vs Improved' },
    { id: 'report', label: 'Final Report' },
  ];

  const panels = {
    overview: <OverviewTab review={review} onSelectTab={selectTab} />,
    logic: <LogicTab review={review} />,
    issues: <IssuesTab review={review} />,
    fix: (
      <FixImproveTab
        review={review}
        codeActions={codeActions}
        selected={selectedAction}
        onSelect={setSelectedAction}
        running={runningAction}
        onRun={runCodeAction}
      />
    ),
    quality: <QualityTab review={review} />,
    suggestions: <SuggestionsTab review={review} />,
    improved: <ImprovedCodeTab review={review} />,
    improvements: <ImprovementsTab review={review} />,
    complexity: <ComplexityTab review={review} />,
    compare: <CompareTab review={review} />,
    report: <ReportTab review={review} onDownload={downloadReport} onPrint={printReport} busy={busy} />,
  };

  const languageCheck = review.staticAnalysis?.languageCheck;

  return (
    <div className="container page">
      <section className="card review-header">
        <div className="review-title">
          <div>
            <p className="eyebrow">Review #{review.id}</p>
            <h1>{languageLabel(review.language)} code review</h1>
            <p className="muted">{formatDateTime(review.createdAt)}</p>
          </div>
          <div className="review-badges">
            <AiStatusBadge status={review.ai.status} />
            <span className="badge score-badge">Score {review.quality.score}/100 · {review.quality.grade}</span>
          </div>
        </div>
        <div className="severity-summary">
          {SEVERITIES.map((severity) => (
            <span key={severity} className="severity-count">
              <SeverityBadge severity={severity} /> {counts[severity] ?? 0}
            </span>
          ))}
        </div>
        <div className="button-row">
          <button type="button" className="btn btn-primary btn-small" onClick={() => downloadReport('html')} disabled={busy}>
            <Icon name="download" size={16} /> Download Review Report
          </button>
          <button type="button" className="btn btn-secondary btn-small" onClick={printReport} disabled={busy}>
            <Icon name="print" size={16} /> Print / PDF
          </button>
          <Link to="/review/new" className="btn btn-secondary btn-small"><Icon name="plus" size={16} /> New Review</Link>
          <button type="button" className="btn btn-danger btn-small" onClick={deleteReview} disabled={busy}>
            <Icon name="trash" size={16} /> Delete
          </button>
        </div>
      </section>

      <ErrorAlert message={actionError} />
      {review.ai.status !== 'completed' && <Alert type="warning" icon="alert">{review.ai.message}</Alert>}
      {languageCheck?.mismatch && (
        <Alert type="warning" icon="alert">
          The code looks like <strong>{languageLabel(languageCheck.detected)}</strong> but was reviewed as{' '}
          <strong>{languageLabel(languageCheck.selected)}</strong>. Results may be inaccurate - consider running a new review with the correct language.
        </Alert>
      )}

      <CodeActionsPanel
        codeActions={codeActions}
        running={runningAction}
        error={codeActionError}
        onRun={runCodeAction}
        onView={showCodeResult}
      />

      <details className="card original-code">
        <summary>Original code ({review.staticAnalysis?.metrics?.totalLines ?? '?'} lines) - click to show</summary>
        <CodeViewer code={review.originalCode} language={review.language} maxHeight={520} />
      </details>

      <Tabs tabs={tabs} active={activeTab} onChange={selectTab} />
      <div id={`panel-${activeTab}`} role="tabpanel" aria-labelledby={`tab-${activeTab}`} className="tab-panel">
        {panels[activeTab]}
      </div>
    </div>
  );
}
