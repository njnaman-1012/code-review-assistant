import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ErrorAlert, LoadingState } from '../components/Feedback.jsx';
import { api, getErrorMessage } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function ForgotPasswordPage() {
  const { status } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (status === 'loading') return <div className="container page"><LoadingState /></div>;
  if (status === 'user') return <Navigate to="/" replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.forgotPassword(email);
      navigate('/reset-password');
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      setSubmitting(false);
    }
  }

  return (
    <div className="container page auth-page">
      <section className="card auth-card">
        <div>
          <h1>Forgot password</h1>
          <p className="muted">Enter your email address. If it has an account, we send a code to choose a new password.</p>
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
          <ErrorAlert message={error} />
          <button type="submit" className="btn btn-primary btn-large" disabled={submitting || !email}>
            {submitting ? 'Sending…' : 'Send code'}
          </button>
        </form>
        <p className="muted small"><Link to="/login" className="link">Back to log in</Link></p>
      </section>
    </div>
  );
}
