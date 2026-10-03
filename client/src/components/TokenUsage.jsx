// The AI token bar. The numbers come from the server (AuthContext) and are
// updated after every AI request.
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export const TOKEN_LIMIT_MESSAGE = 'You have reached your AI usage limit. Please wait for your allowance to reset or contact the administrator.';

const LOW_PERCENT = 20;
const format = (value) => Number(value).toLocaleString('en-US');

// 'ok', 'low' (20% or less left) or 'empty'
function usageLevel(usage) {
  if (usage.remaining <= 0) return 'empty';
  return usage.percentRemaining <= LOW_PERCENT ? 'low' : 'ok';
}

function Bar({ percent, large = false }) {
  return (
    <span
      className={`token-bar${large ? ' large' : ''}`}
      role="progressbar"
      aria-label="AI tokens remaining"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <span className="token-bar-fill" style={{ width: `${percent}%` }} />
    </span>
  );
}

// compact: the small bar in the header (every page). Otherwise: the dashboard card.
export default function TokenUsage({ compact = false }) {
  const { usage } = useAuth();
  if (!usage) return null;

  const level = usageLevel(usage);
  const percent = Math.max(0, Math.min(100, usage.percentRemaining));

  if (compact) {
    return (
      <Link
        to="/"
        className={`token-meter ${level}`}
        title={`AI tokens: ${format(usage.remaining)} of ${format(usage.allocated)} remaining (${percent}%)`}
      >
        <span>AI tokens: <strong>{format(usage.remaining)}</strong> left</span>
        <Bar percent={percent} />
      </Link>
    );
  }

  return (
    <section className={`card token-card ${level}`}>
      <div className="card-head">
        <h2>AI tokens</h2>
        <strong className="token-percent">{percent}% remaining</strong>
      </div>
      <Bar percent={percent} large />
      <dl className="token-stats">
        <div><dt>Allocated</dt><dd>{format(usage.allocated)}</dd></div>
        <div><dt>Used</dt><dd>{format(usage.used)}</dd></div>
        <div><dt>Remaining</dt><dd>{format(usage.remaining)}</dd></div>
      </dl>
      {level === 'low' && <p className="token-note">Your AI tokens are running low.</p>}
      {level === 'empty' && <p className="token-note">{TOKEN_LIMIT_MESSAGE}</p>}
    </section>
  );
}
