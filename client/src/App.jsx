import { Routes, Route } from 'react-router-dom';
import Header from './components/Header.jsx';
import RequireAuth from './components/RequireAuth.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import VerifyEmailPage from './pages/VerifyEmailPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import NewReviewPage from './pages/NewReviewPage.jsx';
import ReviewDetailsPage from './pages/ReviewDetailsPage.jsx';
import HistoryPage from './pages/HistoryPage.jsx';
import AboutPage from './pages/AboutPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

export default function App() {
  return (
    <div className="app">
      <Header />
      <main>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          {/* Pages with personal data: without a login they redirect to /login. */}
          <Route path="/" element={<RequireAuth><DashboardPage /></RequireAuth>} />
          <Route path="/review/new" element={<RequireAuth><NewReviewPage /></RequireAuth>} />
          <Route path="/reviews/:id" element={<RequireAuth><ReviewDetailsPage /></RequireAuth>} />
          <Route path="/history" element={<RequireAuth><HistoryPage /></RequireAuth>} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
      <footer className="site-footer">
        <div className="container">
          © {new Date().getFullYear()} CodeReview AI · Reviews are automated suggestions - always test your code before relying on it.
        </div>
      </footer>
    </div>
  );
}
