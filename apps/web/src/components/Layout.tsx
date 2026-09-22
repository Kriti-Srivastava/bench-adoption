import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.ts';
import { DEFAULT_PARK } from '../format.ts';
import { useMe } from '../queries.ts';

export function Layout() {
  const me = useMe();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.clear();
      navigate('/');
    },
  });
  const user = me.data;
  const isStaff = user?.role === 'staff' || user?.role === 'admin';

  return (
    <>
      <header className="site-header">
        <div className="container">
          <Link to="/" className="brand">
            <img src="/icon.svg" alt="" />
            <span>Adopt a Bench</span>
          </Link>
          <nav className="nav" aria-label="Main">
            <Link to={`/parks/${DEFAULT_PARK}`}>Benches</Link>
            {user && <Link to="/me/benches">My benches</Link>}
            {isStaff && <Link to={`/parks/${DEFAULT_PARK}/staff`}>Staff</Link>}
            {user ? (
              <button className="link-btn" onClick={() => logout.mutate()}>
                Sign out
              </button>
            ) : (
              <Link to={`/sign-in?redirectTo=${encodeURIComponent(location.pathname)}`}>Sign in</Link>
            )}
          </nav>
        </div>
      </header>
      <main>
        <div className="container">
          <Outlet />
        </div>
      </main>
    </>
  );
}
