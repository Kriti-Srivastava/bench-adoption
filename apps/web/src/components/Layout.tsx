import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
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
  const parkPath = `/parks/${DEFAULT_PARK}`;
  // "Map" stays highlighted on bench pages too, but not in the admin area.
  const onMap = location.pathname.startsWith(parkPath) && !location.pathname.startsWith(`${parkPath}/admin`);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="container">
          <Link to="/" className="brand">
            <img src="/icon.svg" alt="" />
            <span>Adopt a Bench</span>
          </Link>
          <nav className="nav" aria-label="Main">
            <NavLink to="/" end>
              Home
            </NavLink>
            <NavLink to={parkPath} className={() => (onMap ? 'active' : '')}>
              Map
            </NavLink>
            {user && !isStaff && <NavLink to="/me">My account</NavLink>}
            {isStaff && <NavLink to={`${parkPath}/admin`}>Admin</NavLink>}
            {user ? (
              <button className="link-btn" onClick={() => logout.mutate()}>
                Sign out
              </button>
            ) : (
              <NavLink to={`/sign-in?redirectTo=${encodeURIComponent(location.pathname)}`}>Sign in</NavLink>
            )}
          </nav>
        </div>
      </header>
      <main id="main">
        <div className="container">
          <Outlet />
        </div>
      </main>
      <footer className="site-footer">
        <div className="container row" style={{ justifyContent: 'space-between' }}>
          <span className="muted small">Van Cortlandt Park Bench Adoption Program</span>
          <nav className="row small" aria-label="Footer">
            <Link to="/">Home</Link>
            <Link to={parkPath}>Bench map</Link>
            {!isStaff && <Link to="/me">My account</Link>}
            {/* The staff entrance: findable, but out of the donors' way. */}
            <Link to="/staff" className="muted">
              Park staff
            </Link>
          </nav>
        </div>
      </footer>
    </>
  );
}
