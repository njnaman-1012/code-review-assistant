import { NavLink, Link, useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';
import TokenUsage from './TokenUsage.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const USER_LINKS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/review/new', label: 'New Review' },
  { to: '/history', label: 'History' },
  { to: '/about', label: 'About' },
];
const GUEST_LINKS = [
  { to: '/about', label: 'About' },
  { to: '/login', label: 'Log in' },
  { to: '/register', label: 'Register' },
];

export default function Header() {
  const { status, user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true }); // a fresh login page, not "back to the previous user's page"
  }
  const links = status === 'user' ? USER_LINKS : status === 'guest' ? GUEST_LINKS : [];

  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link to="/" className="logo" aria-label="CodeReview AI home">
          <span className="logo-mark"><Icon name="code" size={18} strokeWidth={2.6} /></span>
          <span>CodeReview <strong>AI</strong></span>
        </Link>
        <nav className="main-nav" aria-label="Main navigation">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              {link.label}
            </NavLink>
          ))}
        </nav>
        {status === 'user' && (
          <div className="header-user">
            <TokenUsage compact />
            <span className="user-email" title={user.email}>{user.email}</span>
            <button type="button" className="btn btn-secondary btn-small" onClick={handleLogout}>Log out</button>
          </div>
        )}
      </div>
    </header>
  );
}
