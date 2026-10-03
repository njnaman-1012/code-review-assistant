import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Alert, ErrorAlert, LoadingState } from '../components/Feedback.jsx';
import { CodeInput, ResendCode, usePendingVerification } from '../components/CodeEntry.jsx';
import { getErrorMessage } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function VerifyEmailPage() {
  const { status, verifyEmail } = useAuth();
  const pending = usePendingVerification();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Verified: the account is active and logged in - on to the dashboard.
  if (status === 'user') return <Navigate to="/" replace />;
  if (status === 'loading' || pending.status === 'loading') return <div className="container page"><LoadingState /></div>;
  if (pending.status === 'ready' && pending.verification.purpose === 'reset') return <Navigate to="/reset-password" replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    setSubmitting(true);
    try {
      await verifyEmail(code);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      setCode('');
      setSubmitting(false);
    }
  }

  return (
    <div className="container page auth-page">
      <section className="card auth-card">
        <div>
          <h1>Verify your email</h1>
          {pending.status === 'ready'
            ? <p className="muted">Verification code sent to <strong>{pending.verification.email}</strong>. Enter the 6-digit code to activate your account.</p>
            : <p className="muted">There is no verification in progress in this browser.</p>}
        </div>

        {pending.status === 'ready' ? (
          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            <CodeInput value={code} onChange={setCode} disabled={submitting} />
            {notice && <Alert type="info">{notice}</Alert>}
            <ErrorAlert message={error} />
            <button type="submit" className="btn btn-primary btn-large" disabled={submitting || code.length !== 6}>
              {submitting ? 'Verifying…' : 'Verify email'}
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
            <p className="muted small">The code is valid for a few minutes. Also check your spam folder.</p>
          </form>
        ) : (
          <p className="muted small">
            <Link to="/register" className="link">Create an account</Link>, or <Link to="/login" className="link">log in</Link> to
            get a new code for an account you already started.
          </p>
        )}
      </section>
    </div>
  );
}
