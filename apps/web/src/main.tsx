import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider, useParams } from 'react-router-dom';
import { ApiError } from './api.ts';
import { Layout } from './components/Layout.tsx';
import { AdminPage } from './pages/admin/AdminPage.tsx';
import { BenchAdminPage } from './pages/admin/BenchAdminPage.tsx';
import { AdoptPage } from './pages/AdoptPage.tsx';
import { BenchPage } from './pages/BenchPage.tsx';
import { ExplorePage } from './pages/ExplorePage.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { MyBenchesPage } from './pages/MyBenchesPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { SignInPage } from './pages/SignInPage.tsx';
import { VerifyPage } from './pages/VerifyPage.tsx';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Client errors (404, 403...) won't fix themselves on retry.
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

function RedirectToAdmin() {
  const { slug } = useParams();
  return <Navigate to={`/parks/${slug}/admin`} replace />;
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HomePage /> },
      // Bench URLs are printed on plaques as QR codes, so keep them stable.
      { path: '/parks/:slug', element: <ExplorePage /> },
      { path: '/parks/:slug/benches/:code', element: <BenchPage /> },
      { path: '/parks/:slug/benches/:code/adopt', element: <AdoptPage /> },
      { path: '/parks/:slug/admin', element: <AdminPage /> },
      { path: '/parks/:slug/admin/benches/:code', element: <BenchAdminPage /> },
      // The admin area used to be called "staff"; keep old links working.
      { path: '/parks/:slug/staff', element: <RedirectToAdmin /> },
      { path: '/sign-in', element: <SignInPage /> },
      { path: '/auth/verify', element: <VerifyPage /> },
      { path: '/me', element: <MyBenchesPage /> },
      // Emails link here (e.g. renewal reminders).
      { path: '/me/benches', element: <MyBenchesPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
