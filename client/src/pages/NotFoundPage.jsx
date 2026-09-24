import { Link } from 'react-router-dom';
import { EmptyState } from '../components/Feedback.jsx';

export default function NotFoundPage() {
  return (
    <div className="container page">
      <EmptyState icon="alert" title="Page not found" action={<Link to="/" className="btn btn-primary">Go to dashboard</Link>}>
        The page you are looking for does not exist.
      </EmptyState>
    </div>
  );
}
