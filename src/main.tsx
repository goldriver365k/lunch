import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

// 관리자 페이지는 따로 불러와서 소비자 앱이 무거워지지 않게 한다
const AdminApp = lazy(() => import('./admin/AdminApp'));
const BusinessApp = lazy(() => import('./market/BusinessApp'));
const path = window.location.pathname;
const isAdminPath = path === '/admin' || path.startsWith('/admin/');
// 사업자용 상권 분석 — /business/market (/business도 같은 화면)
const isBusinessPath = path === '/business' || path.startsWith('/business/');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdminPath ? (
      <Suspense fallback={null}>
        <AdminApp />
      </Suspense>
    ) : isBusinessPath ? (
      <Suspense fallback={null}>
        <BusinessApp />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
