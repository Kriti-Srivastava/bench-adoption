import { Link, Navigate, useParams } from 'react-router-dom';
import { SignInForm } from '../components/SignInForm.tsx';
import { Loadable } from '../components/ui.tsx';
import { DEFAULT_PARK } from '../format.ts';
import { useIsStaff, useMe } from '../queries.ts';

/**
 * The park staff entrance, reached from the small link in the footer. It is
 * deliberately separate from the donor sign-in: staff accounts look after the
 * park and cannot adopt benches, and their links are short-lived.
 */
export function StaffSignInPage() {
  const { slug = DEFAULT_PARK } = useParams();
  const me = useMe();
  const { isStaff } = useIsStaff();

  if (isStaff) return <Navigate to={`/parks/${slug}/admin`} replace />;

  return (
    <div className="narrow stack">
      <h1>Park staff</h1>
      <Loadable query={me}>
        {(user) => (
          <div className="card stack">
            {user ? (
              <>
                <p>
                  You are signed in as <strong>{user.email}</strong>, which is a donor account.
                </p>
                <p className="muted">
                  Staff accounts are separate. Sign out, then ask for a staff link with your park
                  email address.
                </p>
              </>
            ) : (
              <SignInForm
                audience="staff"
                redirectTo={`/parks/${slug}/admin`}
                intro="Enter your park email address and we'll send you a link to the staff area. Staff links expire in 5 minutes."
              />
            )}
            <p className="muted small" style={{ margin: 0 }}>
              Adopting a bench? <Link to="/sign-in">Sign in as a donor</Link> instead.
            </p>
          </div>
        )}
      </Loadable>
    </div>
  );
}
