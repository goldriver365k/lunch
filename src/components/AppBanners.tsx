import { useEffect, useState } from 'react';

/** 새 버전 알림 — main.tsx의 서비스 워커 등록이 보내는 이벤트 */
export const APP_UPDATED_EVENT = 'mwomeok:updated';

/** 관리자 공지, 오프라인, 새 버전 안내 */
export function AppBanners({ notice }: { notice: string | null }) {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const [updated, setUpdated] = useState(false);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    const up = () => setUpdated(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    window.addEventListener(APP_UPDATED_EVENT, up);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener(APP_UPDATED_EVENT, up);
    };
  }, []);
  return (
    <>
      {notice && (
        <p className="app-banner notice" role="status">
          📢 {notice}
        </p>
      )}
      {!online && (
        <p className="app-banner offline" role="alert">
          인터넷 연결이 없어요. 음식점·주문 정보는 연결되면 다시 불러와요 (이전 정보를 최신처럼 보여주지 않아요).
        </p>
      )}
      {updated && (
        <p className="app-banner update" role="status">
          새 버전이 준비됐어요.{' '}
          <button type="button" className="link-button inline" onClick={() => window.location.reload()}>
            새로고침
          </button>
        </p>
      )}
    </>
  );
}
