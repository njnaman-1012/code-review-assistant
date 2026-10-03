import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Alert, ErrorAlert, LoadingState } from '../components/Feedback.jsx';
import { CodeInput, ResendCode, usePendingVerification } from '../components/CodeEntry.jsx';
import { api, getErrorMessage } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function ResetPasswordPage() {
  const { status } = useAuth();
  const navigate = useNavigate();
  const pending = usePendingVerification();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (status === 'user') return <Navigate to="/" replace />;
  if (status === 'loading' || pending.status === 'loading') return <div className="container page"><LoadingState /></div>;
  // No reset in progress in this browser: start with the e-mail address.
  if (pending.status === 'none') return <Navigate to="/forgot-password" replace />;
  if (pending.verification.purpose !== 'reset') return <Navigate to="/verify-email" replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (password !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await api.resetPassword({ otp: code, password, confirmPassword });
      navigate('/login', { replace: true, state: { notice: 'Your password was changed. Log in with the new password.' } });
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      setSubmitting(false);
    }
  }

  return (
    <div className="container page auth-page">
      <section className="card auth-card">
        <div>
          <h1>Choose a new password</h1>
          <p className="muted">
            If <strong>{pending.verification.email}</strong> has an account, a 6-digit code was sent to it. Enter the code and your new password.
          </p>
        </div>
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <CodeInput value={code} onChange={setCode} disabled={submitting} />
          <label className="field">
            <span>New password</span>
            <input
              className="text-input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
              required
            />
            <span className="field-hint">At least 8 characters, with a letter and a number.</span>
          </label>
          <label className="field">
            <span>Confirm new password</span>
            <input
              className="text-input"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              disabled={submitting}
              required
            />
          </label>
          {notice && <Alert type="info">{notice}</Alert>}
          <ErrorAlert message={error} />
          <button
            type="submit"
            className="btn btn-primary btn-large"
            disabled={submitting || code.length !== 6 || !password || !confirmPassword}
          >
            {submitting ? 'Saving…' : 'Change password'}
          </button>
          <ResendCode
            verification={pending.verification}
            onError={setError}
            onResent={(verification) => {
              pending.setVerification(verification);
              setCode('');
              setNotice('A new code was sent. The previous code no longer works.');
            }}
          />
        </form>
        <p className="muted small"><Link to="/login" className="link">Back to log in</Link></p>
      </section>
    </div>
  );
}
