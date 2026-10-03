import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert, ErrorAlert, LoadingState } from '../components/Feedback.jsx';
import { getErrorCode, getErrorMessage } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function LoginPage() {
  const { status, login } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (status === 'loading') return <div className="container page"><LoadingState /></div>;
  // Logged in: continue to the page the user wanted, or to the dashboard.
  if (status === 'user') return <Navigate to={location.state?.from || '/'} replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login({ email, password });
    } catch (requestError) {
      // Right password, but the e-mail address was never verified: a code was sent (now, or a moment ago).
      if (['EMAIL_NOT_VERIFIED', 'OTP_COOLDOWN'].includes(getErrorCode(requestError))) {
        navigate('/verify-email');
        return;
      }
      setError(getErrorMessage(requestError));
      setSubmitting(false);
    }
  }

  return (
    <div className="container page auth-page">
      <section className="card auth-card">
        <div>
          <h1>Log in</h1>
          <p className="muted">Log in to review code and see your review history.</p>
        </div>
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span>Email</span>
            <input
              className="text-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting}
              autoFocus
              required
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              className="text-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
              required
            />
          </label>
          {location.state?.notice && !error && <Alert type="info">{location.state.notice}</Alert>}
          <ErrorAlert message={error} />
          <button type="submit" className="btn btn-primary btn-large" disabled={submitting || !email || !password}>
            {submitting ? 'Logging in…' : 'Log in'}
          </button>
        </form>
        <p className="muted small auth-links">
          <span>No account yet? <Link to="/register" className="link">Create an account</Link></span>
          <Link to="/forgot-password" className="link">Forgot password?</Link>
        </p>
      </section>
    </div>
  );
}
