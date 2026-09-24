import { NavLink, Link } from 'react-router-dom';
import Icon from './Icon.jsx';

const LINKS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/review/new', label: 'New Review' },
  { to: '/history', label: 'History' },
  { to: '/about', label: 'About' },
];

export default function Header() {
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link to="/" className="logo" aria-label="CodeReview AI home">
          <span className="logo-mark"><Icon name="code" size={18} strokeWidth={2.6} /></span>
          <span>CodeReview <strong>AI</strong></span>
        </Link>
        <nav className="main-nav" aria-label="Main navigation">
          {LINKS.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              {link.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}
