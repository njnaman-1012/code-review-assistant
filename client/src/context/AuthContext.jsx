// Who is logged in, and their AI token balance. Both always come from the
// server: the browser only displays them and cannot change them.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setApiListeners } from '../services/api.js';

const AuthContext = createContext(null);
const GUEST = { status: 'guest', user: null, usage: null };

// The editor keeps a draft in sessionStorage ("cra." keys). The draft belongs
// to one user: it is removed on logout and when a different user logs in.
const OWNER_KEY = 'cra.owner';
function clearDraft() {
  try {
    Object.keys(sessionStorage)
      .filter((key) => key.startsWith('cra.'))
      .forEach((key) => sessionStorage.removeItem(key));
  } catch {
    // Storage can be unavailable (private mode) - nothing to clear.
  }
}
function claimDraft(userId) {
  try {
    if (sessionStorage.getItem(OWNER_KEY) !== String(userId)) clearDraft();
    sessionStorage.setItem(OWNER_KEY, String(userId));
  } catch {
    // Storage can be unavailable (private mode).
  }
}

export function AuthProvider({ children }) {
  // status: 'loading' (asking the server), 'guest' or 'user'.
  // loggedOut: the user clicked "Log out" (as opposed to a session that expired).
  const [session, setSession] = useState({ status: 'loading', user: null, usage: null });

  const signIn = useCallback(({ user, usage }) => {
    claimDraft(user.id);
    setSession({ status: 'user', user, usage });
  }, []);

  // Loads the user and the token balance again from the server.
  const refresh = useCallback(async () => {
    try {
      signIn(await api.getSession());
    } catch (error) {
      if (error?.response?.status === 401) setSession(GUEST);
    }
  }, [signIn]);

  useEffect(() => {
    setApiListeners({
      onUsage: (usage) => setSession((current) => (current.status === 'user' ? { ...current, usage } : current)),
      onUnauthorized: () => setSession(GUEST),
      onAiRequestFailed: refresh,
    });
    // Page load or refresh: the session cookie decides whether the user is still logged in.
    api.getSession().then(signIn).catch(() => setSession(GUEST));
    return () => setApiListeners({ onUsage: null, onUnauthorized: null, onAiRequestFailed: null });
  }, [signIn, refresh]);

  const value = useMemo(() => ({
    ...session,
    refresh,
    async login(credentials) {
      signIn(await api.login(credentials));
    },
    // Registration only starts the account: the user is logged in after
    // entering the code that was e-mailed.
    async verifyEmail(otp) {
      signIn(await api.verifyEmail(otp));
    },
    async logout() {
      try {
        await api.logout(); // the server ends the session and removes the cookie
      } catch {
        // Offline: the page still returns to the login screen.
      }
      clearDraft();
      setSession({ ...GUEST, loggedOut: true });
    },
  }), [session, refresh, signIn]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
