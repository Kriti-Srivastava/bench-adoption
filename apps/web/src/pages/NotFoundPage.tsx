import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="narrow stack">
      <h1>Page not found</h1>
      <p>
        <Link to="/">Browse benches</Link>
      </p>
    </div>
  );
}
