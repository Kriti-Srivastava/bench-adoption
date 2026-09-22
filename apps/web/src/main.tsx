import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { ApiError } from './api.ts';
import { Layout } from './components/Layout.tsx';
import { AdoptPage } from './pages/AdoptPage.tsx';
import { BenchPage } from './pages/BenchPage.tsx';
import { ExplorePage } from './pages/ExplorePage.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { MyBenchesPage } from './pages/MyBenchesPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { SignInPage } from './pages/SignInPage.tsx';
import { StaffPage } from './pages/StaffPage.tsx';
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

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HomePage /> },
      // Bench URLs are printed on plaques as QR codes, so keep them stable.
      { path: '/parks/:slug', element: <ExplorePage /> },
      { path: '/parks/:slug/benches/:code', element: <BenchPage /> },
      { path: '/parks/:slug/benches/:code/adopt', element: <AdoptPage /> },
      { path: '/parks/:slug/staff', element: <StaffPage /> },
      { path: '/sign-in', element: <SignInPage /> },
      { path: '/auth/verify', element: <VerifyPage /> },
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
