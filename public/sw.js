/* 점심뭐먹 서비스 워커 — 앱의 정적 파일만 캐시한다.
 * - 음식점·주문·관리자·인증 등 API 응답(다른 주소)은 절대 캐시하지 않는다 (오래된 정보가 최신처럼 보이지 않게).
 * - 화면(HTML)은 항상 네트워크 먼저: 새 버전을 배포하면 바로 새 화면을 받는다. 오프라인일 때만 저장해 둔 화면을 쓴다.
 * - 빌드마다 등록 주소의 ?v= 값이 바뀌어 새 워커가 설치되고, 이전 버전 캐시는 지운다.
 */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `mwomeok-static-${VERSION}`;
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mwomeok-static-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 같은 주소의 정적 파일만. Supabase API·지도·외부 요청과 버전 정보는 손대지 않는다
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/sw.js' || url.pathname === '/version.json') return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put('/', res.clone()));
          return res;
        })
        .catch(() => caches.match('/').then((r) => r || Response.error())),
    );
    return;
  }
  // 빌드 결과(/assets/*)는 파일 이름에 내용 해시가 있어 바뀌지 않는다 → 캐시 우선
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
