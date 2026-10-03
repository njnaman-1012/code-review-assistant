// Wraps a page that needs a logged-in user. Guests are sent to the login
// page. (The server checks the login again for every API request.)
import { Navigate, useLocation } from 'react-router-dom';
import { LoadingState } from './Feedback.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function RequireAuth({ children }) {
  const { status, loggedOut } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <div className="container page"><LoadingState message="Checking your login…" /></div>;
  }
  if (status !== 'user') {
    // After an expired session the user returns to this page; after "Log out" the next login starts on the dashboard.
    return <Navigate to="/login" replace state={loggedOut ? null : { from: location.pathname }} />;
  }
  return children;
}
