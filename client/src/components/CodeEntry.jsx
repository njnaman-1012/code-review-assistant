// Parts shared by the pages where a 6-digit code from an e-mail is entered
// ("Verify email" and "Reset password").
import { useEffect, useState } from 'react';
import { api, getErrorMessage } from '../services/api.js';

// Loads the code that is pending for this browser (the server knows it from
// an httpOnly cookie). status: 'loading' | 'ready' | 'none'
export function usePendingVerification() {
  const [state, setState] = useState({ status: 'loading', verification: null });

  useEffect(() => {
    let active = true;
    api.getVerification()
      .then((verification) => active && setState({ status: 'ready', verification }))
      .catch(() => active && setState({ status: 'none', verification: null }));
    return () => { active = false; };
  }, []);

  const setVerification = (verification) => setState({ status: 'ready', verification });
  return { ...state, setVerification };
}

// The 6-digit code field: digits only.
export function CodeInput({ value, onChange, disabled }) {
  return (
    <input
      className="text-input otp-input"
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]{6}"
      maxLength={6}
      placeholder="••••••"
      aria-label="6-digit code"
      value={value}
      onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
      disabled={disabled}
      autoFocus
      required
    />
  );
}

// "Resend code" with a countdown until the server allows a new code.
export function ResendCode({ verification, onResent, onError }) {
  const [seconds, setSeconds] = useState(verification.resendInSeconds);
  const [sending, setSending] = useState(false);

  useEffect(() => setSeconds(verification.resendInSeconds), [verification]);
  useEffect(() => {
    if (seconds <= 0) return undefined;
    const timer = setTimeout(() => setSeconds((current) => current - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  async function resend() {
    setSending(true);
    onError('');
    try {
      onResent(await api.resendOtp());
    } catch (error) {
      onError(getErrorMessage(error));
    } finally {
      setSending(false);
    }
  }

  return (
    <button type="button" className="btn btn-secondary" onClick={resend} disabled={sending || seconds > 0}>
      {seconds > 0 ? `Resend code in ${seconds}s` : sending ? 'Sending…' : 'Resend code'}
    </button>
  );
}
