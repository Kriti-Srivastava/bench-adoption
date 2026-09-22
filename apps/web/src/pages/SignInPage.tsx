import { Navigate, useSearchParams } from 'react-router-dom';
import { SignInForm } from '../components/SignInForm.tsx';
import { useMe } from '../queries.ts';

export function SignInPage() {
  const [params] = useSearchParams();
  const redirectTo = params.get('redirectTo') ?? '/me/benches';
  const me = useMe();

  if (me.data) return <Navigate to={redirectTo} replace />;
  return (
    <div className="narrow stack">
      <h1>Sign in</h1>
      <div className="card">
        <SignInForm
          redirectTo={redirectTo}
          intro="Enter your email and we'll send you a link to sign in. New here? The same link creates your account."
        />
      </div>
    </div>
  );
}
