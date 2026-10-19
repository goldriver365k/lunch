# 뭐먹 — 지금 다들 뭐 먹어?

내 주변에서 지금 사람들이 많이 먹는 식사를 보여주는 모바일 웹앱 (3단계 프로토타입).

> ⚠️ 위치는 브라우저 GPS를 쓰지만, 음식점·좌표·가격·주문 수는 모두 **가상 데이터**입니다.
> 길찾기는 카카오맵·네이버지도의 공식 URL로 외부 지도를 여는 방식만 쓰며, 지도 SDK·장소검색 API·음식점 DB, POS,
> 배민·쿠팡이츠, 카드사 데이터, Supabase, 유료 서비스는 연동하지 않았습니다.

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

## 기능 (1~3단계)

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

### 가상 매장 배치
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
  types.ts                   타입 정의
```
