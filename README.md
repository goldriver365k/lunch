# 뭐먹 — 지금 다들 뭐 먹어?

내 주변에서 지금 사람들이 많이 먹는 식사를 보여주는 모바일 웹앱 (1단계 프로토타입).

> ⚠️ 1단계는 **가상 데이터**만 사용합니다. 음식점·가격·주문 수는 모두 지어낸 값입니다.
> 실제 지도 API, POS, 배민·쿠팡이츠, 카드사 데이터, Supabase, 유료 서비스는 연동하지 않았습니다.

## 실행

```bash
npm install
npm run dev        # http://localhost:5173 (같은 Wi-Fi의 휴대폰에서는 터미널에 표시되는 Network 주소로 접속)
```

| 명령 | 설명 |
| --- | --- |
| `npm test` | 단위·화면 테스트 (Vitest + Testing Library) |
| `npm run lint` | ESLint |
| `npm run build` | 타입 검사 + 프로덕션 빌드 (`dist/`) |
| `npm run preview` | 빌드 결과 미리보기 |

## 1단계 기능

- 도보 식사 · 배달 · 포장 3개 탭
- 도보 식사·포장 검색 반경 30m / 50m / 70m / 100m (배달은 반경 제한 없음)
- 음식 종류(한식·중식·일식·양식·분식·아시안·패스트푸드·카페·디저트) 칩 + 키워드 검색(가게명·종류·메뉴명)
- 실시간 인기순(가상 주문 수, 15초마다 무작위 변동) / 거리순 정렬
- 음식점을 누르면 대표메뉴와 가격 펼침

## 구조

```
src/
  App.tsx                    화면 조립·상태
  components/                ModeTabs, RadiusSelector, CategoryFilter, SortToggle, RestaurantCard
  data/mockRestaurants.ts    ⚠️ 가상 음식점 데이터
  lib/constants.ts           앱 이름·슬로건·탭·반경·카테고리 상수
  lib/restaurants.ts         필터·정렬·포맷·가상 실시간 시뮬레이션 (순수 함수)
  types.ts                   타입 정의
```
