import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ErrorAlert, LoadingState } from '../components/Feedback.jsx';
import { api, getErrorMessage } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function RegisterPage() {
  const { status } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (status === 'loading') return <div className="container page"><LoadingState /></div>;
  if (status === 'user') return <Navigate to="/" replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      // The server validates everything again and e-mails a 6-digit code;
      // the account becomes active when the code is entered on the next page.
      await api.register({ email, password, confirmPassword });
      navigate('/verify-email');
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      setSubmitting(false);
    }
  }

  return (
    <div className="container page auth-page">
      <section className="card auth-card">
        <div>
          <h1>Create an account</h1>
          <p className="muted">Your reviews and history are private to your account. We send a code to your email to verify it.</p>
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
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
              required
            />
            <span className="field-hint">At least 8 characters, with a letter and a number.</span>
          </label>
          <label className="field">
            <span>Confirm password</span>
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
          <ErrorAlert message={error} />
          <button
            type="submit"
            className="btn btn-primary btn-large"
            disabled={submitting || !email || !password || !confirmPassword}
          >
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        <p className="muted small">Already have an account? <Link to="/login" className="link">Log in</Link></p>
      </section>
    </div>
  );
}
