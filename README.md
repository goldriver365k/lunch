# 뭐먹 — 지금 다들 뭐 먹어?

내 주변에서 지금 사람들이 많이 먹는 식사를 보여주는 모바일 웹앱 (2단계 프로토타입).

> ⚠️ 위치는 브라우저 GPS를 쓰지만, 음식점·좌표·가격·주문 수는 모두 **가상 데이터**입니다.
> 실제 지도 API·길찾기, 음식점 DB, POS, 배민·쿠팡이츠, 카드사 데이터, Supabase, 유료 서비스는 연동하지 않았습니다.

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

## 기능 (1·2단계)

- 도보 식사 · 배달 · 포장 3개 탭
- **GPS 현재 위치** 확인 (Geolocation API). 실패·거부·미지원 시 **선릉·판교·여의도 시범 위치** 선택, GPS 다시 시도
- 도보 식사·포장 검색 반경 **100m(기본) / 200m / 300m**
- 매장 좌표와 기준 위치로 **직선거리(하버사인)** 계산, 도보 시간은 분당 67m 기준
- **배달**: 검색 반경 없이 **배달 주소**(현재 위치 또는 시범 지역) 기준, 매장별 배달 가능 거리(기본 3km) 적용
- 기본 정렬 **최근 주문 많은 순** (가상 주문 수, 15초마다 변동, `(가상)` 표시) / 거리순
- 음식 종류 칩 + 키워드 검색(가게명·종류·메뉴명)
- 음식점을 누르면 대표메뉴와 가격 펼침

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
  lib/restaurants.ts         필터·정렬·포맷·가상 실시간 시뮬레이션 (순수 함수)
  types.ts                   타입 정의
```
