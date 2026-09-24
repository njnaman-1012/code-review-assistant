import { Routes, Route } from 'react-router-dom';
import Header from './components/Header.jsx';
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
          <Route path="/" element={<DashboardPage />} />
          <Route path="/review/new" element={<NewReviewPage />} />
          <Route path="/reviews/:id" element={<ReviewDetailsPage />} />
          <Route path="/history" element={<HistoryPage />} />
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
