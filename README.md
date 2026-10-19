# 점심뭐먹 — 지금 다들 뭐 먹어?

내 주변에서 지금 사람들이 많이 먹는 식사를 보여주는 모바일 웹앱 (4단계).

> - **Supabase를 연결하면** 실제 음식점 DB(공공데이터 + 관리자 입력)를 서버에서 반경 검색합니다.
> - **연결하지 않으면** 기존 가상 데이터(데모)로 동작합니다. 두 데이터는 섞이지 않습니다.
> - 주문 데이터 수집(홀 POS·배민·쿠팡이츠·포장)은 구조와 관리자 기능까지 만들었고, **실제 제공업체 계약·API 명세가 없어 실제 연결은 미검증**입니다(모든 외부 연동은 ‘연동 준비’ 상태, 외부 호출 없음). 기능은 가상 테스트 주문과 주문 CSV로 시험합니다.
> - 길찾기는 카카오맵·네이버지도 공식 URL만 쓰며 유료 API는 쓰지 않습니다.

## 실행

```bash
npm install
npm run dev        # http://localhost:5173
```

> 📍 브라우저 GPS는 **HTTPS 또는 localhost**에서만 동작합니다. 휴대폰에서 `http://192.168.x.x:5173`처럼 접속하면
> 위치 권한이 막히므로, 그때는 화면에 나오는 선릉·판교·여의도 시범 위치를 골라 확인하세요.

| 명령 | 설명 |
| --- | --- |
| `npm test` | 단위·화면 테스트 (Vitest + Testing Library) |
| `npm run lint` | ESLint |
| `npm run build` | 타입 검사 + 프로덕션 빌드 (`dist/`) |
| `npm run preview` | 빌드 결과 미리보기 |

## 실제 DB 연결 (Supabase 무료 플랜)

결제 정보 없이 무료 플랜으로 됩니다. 아래는 프로젝트 소유자가 직접 해야 하는 작업입니다.

1. [supabase.com](https://supabase.com)에서 새 프로젝트를 만듭니다 (Free).
2. **SQL Editor**에서 `supabase/migrations/` 의 파일을 이름 순서대로 실행합니다 (`…stage4_restaurants.sql` → `…stage5_orders.sql`).
   PostGIS 확장, 음식점·메뉴 테이블, 공간 인덱스, RLS, 검색·관리자 함수가 만들어집니다. 두 번 실행해도 안전합니다.
3. **Authentication → Users → Add user**로 관리자 계정(이메일·비밀번호)을 만듭니다.
   일반 회원가입은 쓰지 않으므로 **Authentication → Sign In / Providers → Email**에서 *Allow new users to sign up*을 끄는 것을 권장합니다.
4. SQL Editor에서 그 계정을 관리자로 지정합니다.
   ```sql
   insert into public.admin_users (user_id) select id from auth.users where email = '관리자 이메일';
   ```
5. `.env.example`을 `.env.local`로 복사하고 **Project Settings → API**의 Project URL과 **anon public** 키를 넣은 뒤 `npm run dev`를 다시 실행합니다.
   **service_role 키는 절대 넣지 마세요** (브라우저 코드에 포함됩니다). 권한은 DB의 RLS와 `is_admin()`이 서버에서 검사합니다.
6. 공공데이터포털 [전국일반음식점표준데이터](https://www.data.go.kr/data/15096283/standard.do)에서 CSV를 내려받아(로그인 필요)
   `/admin` → **CSV 업로드**에서 올립니다. 미리보기의 ‘지도에서 보기’로 2~3곳 좌표를 확인한 뒤 승인합니다.
7. 배포할 때는 `/admin` 경로도 `index.html`로 연결되도록 호스팅의 SPA 리라이트를 설정합니다 (`npm run preview`는 자동).

| 경로 | 내용 |
| --- | --- |
| `/` | 소비자 앱 |
| `/admin` | 관리자 (로그인 + `admin_users` 등록 계정만) — 홈 통계 · 음식점·메뉴 · CSV 업로드 · 테스트 위치 |

### 주문 데이터 (5단계) 추가 설정
- **집계 갱신(선택, 무료)**: Database → Extensions에서 `pg_cron`을 켜고 SQL Editor에서
  `select cron.schedule('refresh-order-aggregates', '*/5 * * * *', $$select public.refresh_order_aggregates()$$);`
  — 주문이 들어올 때도 자동 갱신되며, 15분(설정 가능)보다 오래된 집계는 소비자에게 보이지 않습니다.
- **웹훅 수신(제공업체 계약 후)**: `supabase functions deploy order-webhook --no-verify-jwt`,
  서명 키는 `supabase secrets set ORDER_WEBHOOK_<연동의 서버 비밀값 이름>=<키>`로만 저장합니다 (DB·브라우저에 넣지 않음).
  요청 `POST /functions/v1/order-webhook?connection=<연동 ID>&format=canonical`, 헤더 `X-Signature: sha256=<본문 HMAC-SHA256>`.
- **주문 CSV 형식** (한 행 = 주문 메뉴 1개): 필수 `주문번호, 주문시각, 채널(홀/배달/포장), 메뉴명, 수량, 주문총금액`,
  선택 `연결번호, 결제시각, 단가, 판매금액, 할인금액, 환불금액, 결제상태, 취소여부`. 시간대가 없으면 한국시간. 다른 열(고객 정보 등)은 읽지 않습니다.

DB 마이그레이션은 로컬 PostgreSQL 16 + PostGIS 3에서 시험할 수 있습니다:
`PGHOST=… PGPORT=… PGUSER=postgres supabase/tests/run_local_db_test.sh`

## 기능 (1~5단계)

- 도보 식사 · 배달 · 포장 3개 탭
- **GPS 현재 위치** 확인 (Geolocation API). 실패·거부·미지원 시 **선릉·판교·여의도 시범 위치** 선택, GPS 다시 시도
- 도보 식사·포장 검색 반경 **100m(기본) / 200m / 300m**
- 매장 좌표와 기준 위치로 **직선거리(하버사인)** 계산, 도보 시간은 분당 67m 기준
- **배달**: 검색 반경 없이 **배달 주소**(현재 위치 또는 시범 지역) 기준, 매장별 배달 가능 거리(기본 3km) 적용
- 기본 정렬 **최근 주문 많은 순** (가상 주문 수, 15초마다 변동, `(가상)` 표시) / 거리순
- 음식 종류 칩 + 키워드 검색(가게명·종류·메뉴명)
- 목록 카드에 대표메뉴·가격 표시, 누르면 **매장 상세화면** (이름·종류·직선거리·주소·대표메뉴·가격·추가 메뉴·채널별 최근 주문 수·데이터 기준시각)
- **홀·배달·포장 가격 분리**: 메뉴마다 채널별 가격을 따로 저장, 해당 채널 가격이 없는 메뉴는 숨김, 주문 수도 채널별(합산 안 함)
- 메뉴가 없으면 `메뉴정보 준비 중`
- 상세화면은 history 항목으로 열려서 화면의 ‹ 목록 / 기기 뒤로 가기 모두로 닫히며, 검색조건과 스크롤 위치가 유지됨
- **매장찾기**(도보 식사·포장): 처음 한 번 카카오맵/네이버지도 선택 → 로컬 저장소에 기억 → 다음부터 바로 연결, ‘지도 변경’으로 변경
  - 카카오맵 웹 `https://map.kakao.com/link/by/walk/출발,위도,경도/도착,위도,경도` (기본) · 앱 `kakaomap://route?sp=&ep=&by=FOOT`
  - 네이버지도 앱 `nmap://route/walk?slat&slng&sname&dlat&dlng&dname&appname` → 앱이 없을 때를 위한 카카오맵 웹 대안 안내
  - 출발지는 **실제 GPS 위치만** 사용. 시범 위치·GPS 실패 시 출발지를 임의로 넣지 않고 ‘GPS로 확인’ 또는 ‘지도에서 출발지 선택’(도착지만 지정) 안내
  - **가상 매장 좌표는 길찾기에 쓰지 않음** (`coordVerified: false`) → `매장 위치정보를 확인할 수 없습니다`
  - 연결 시험은 하단 **‘길찾기 연결 시험 · 지도 설정’**에서 선릉역·판교역·여의도역으로 (역 중심 근사 좌표)

### 4단계 — 실제 음식점 DB·관리자
- **위치 검색**: `search_restaurants` RPC가 PostGIS `ST_DWithin` + GiST 공간 인덱스로 서버에서 100·200·300m만 검색 (휴대폰에 전체 데이터를 받지 않음)
- **주문정보 없음 처리**: 0건으로 보지 않고 ‘실시간 주문정보 준비 중’ + 가까운 순
- **운영 여부** 확인됨/운영 안 함/미확인 — 배달은 배달 확인 + 배달 가능 거리가 확인된 매장만, 포장은 확인 매장 우선
- **가격** 미확인은 ‘가격정보 없음’ (DB에 0원 저장 불가)
- **공공데이터 CSV 업로드**: CP949/UTF-8 자동 인식, 조각 단위 스트리밍, 지역 필터, EPSG:5174→WGS84 변환(PROJ 공식 변환과 0.05m 이내), 관리번호 중복 판별, 폐업·휴업 제외, 좌표 오류·누락 비공개 분류, 미리보기 후 승인, 한 트랜잭션 반영(실패 시 기존 데이터 무변경), 재업로드해도 중복·메뉴 손실 없음
- **관리자 테스트 위치**: 실제 GPS / 선릉역 / 역삼역 / 판교역 / 여의도역 — 소비자 화면 상단 ‘테스트 모드 — ○○역 기준’, 서버에서 관리자 확인 시에만 켜짐, 매장찾기 출발지로 쓰지 않음
- **GPS 정확도**가 ±100m보다 나쁘면 재확인 안내

### 5단계 — 주문 데이터 수집
- 채널 HALL·DELIVERY·PICKUP·UNKNOWN, 제공처 pos·baemin·coupangeats·csv를 따로 저장 (`orders`·`order_items`), 개인정보 열 없음
- 수집 경로: 승인된 웹훅(Edge Function `order-webhook`) → 공식 조회 API 주기 호출(`pollOnce`, 호출 전 `reserve_api_calls`로 한도·예산 확인) → POS 파일·주문 CSV
- 중복 방지: (제공처·매장·외부 주문번호)로 재수집은 갱신, POS↔배달앱 연결번호가 같으면 통합, 연결번호 없이 같은 채널·금액·3분 이내면 ‘중복 가능성 확인 필요’(합산 안 함, 관리자 판정)
- 집계 `order_aggregates`: 최근 10·30·60분, 오늘 점심(11~14시), 오늘 — 채널별 유효 건수·제공처별 건수·메뉴별 수량·총액·할인/환불 반영액·갱신시각·제공 상태
- 소비자: 공개 허용 + 실제 데이터 + 최소 공개 건수(기본 5, 관리자 변경) 이상 + 최근 갱신 집계만 ‘최근 30분 홀 주문 활발’처럼 단계로 표시, 연동 안 된 매장은 ‘주문정보 없음’. 목록 순서는 바꾸지 않음(6단계)
- 테스트 주문은 `is_test`로 분리 — 소비자 공개·실제 통계에 포함되지 않고, 관리자 테스트 모드에서만 ‘테스트 데이터’로 보임
- 관리자 `/admin` → **주문 데이터**: 현황 · 매장별 · 연동 관리(승인 상태·동의·공개 허용·연결 테스트·중단/재개·오류·호출량·예상 비용) · 주문 CSV · 확인 필요(중복·메뉴 매칭) · 테스트 데이터 · 설정

### 가상 매장 배치 (DB 미연결 데모)
- 현재 위치가 시범 지역 중심 500m 이내면 그 지역의 가상 매장을 사용
- 그 밖이면 현재 위치 주변에 같은 가상 매장 템플릿을 배치 (화면에 안내 문구 표시)

## 구조

```
src/
  App.tsx                    화면 조립·상태
  components/                ModeTabs, RadiusSelector, CategoryFilter, SortToggle, RestaurantCard,
                             LocationPanel, PilotPicker, DeliveryAddressPanel
  hooks/useCurrentLocation.ts  GPS 위치 확인 + 오류 처리 + 시범 위치 선택
  data/pilotAreas.ts         선릉·판교·여의도 시범 위치 좌표
  data/mockRestaurants.ts    ⚠️ 가상 음식점 템플릿 + 지역별 배치
  lib/geo.ts                 직선거리(하버사인)·좌표 이동 계산
  lib/constants.ts           앱 이름·슬로건·탭·반경·카테고리 상수
  lib/restaurants.ts         필터·정렬·채널별 메뉴·포맷·가상 실시간 시뮬레이션 (순수 함수)
  lib/mapLinks.ts            카카오맵·네이버지도 도보 길찾기 URL, 좌표 검증, 지도 선택 저장
  hooks/useRouteFinder.ts    매장찾기 흐름 (지도 선택 → 출발지 확인 → 외부 지도 열기)
  components/RestaurantDetail.tsx, RouteSheets.tsx, BottomSheet.tsx
  data/routeTestPlaces.ts    길찾기 연결 시험 목적지 (역)
  data/stations.ts           선릉·역삼·판교·여의도역 좌표 (위키백과·위키데이터 대조)
  lib/supabase.ts            Supabase 클라이언트 (환경변수 없으면 null → 데모)
  lib/db/restaurantsApi.ts   서버 반경 검색 RPC 호출·DB 행 변환
  lib/publicData/            CSV 스트리밍 파서·좌표 변환·가져오기 계획
  hooks/useRestaurantData.ts 가상/실제 데이터 선택 (섞지 않음)
  hooks/useTestLocation.ts   관리자 테스트 위치 (서버 관리자 확인)
  admin/                     /admin 관리자 화면
  lib/orders/                주문 연결 모듈(공통 인터페이스·POS·배민·쿠팡이츠 분리), 주문 CSV, 테스트 주문 생성
  lib/activity.ts            소비자 주문 활발도 표시
  admin/orders/              /admin 주문 데이터 화면
supabase/
  functions/_shared/         공통 주문 형식·웹훅 처리 (Edge Function과 관리자 화면이 같이 사용)
  functions/order-webhook/   승인된 웹훅 수신 Edge Function
  migrations/                DB 스키마·RLS·함수
  tests/                     로컬 PostGIS 시험 (RLS·반경·가져오기)
  types.ts                   타입 정의
```
