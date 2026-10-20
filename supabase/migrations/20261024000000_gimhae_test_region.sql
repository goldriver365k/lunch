-- 운영자 현장 시험 지역: 김해 인제대학교 주변
-- 실제 휴대폰 GPS·도보 동선·매장 입구·영업 여부를 운영자가 직접 확인하기 위한 지역이다 (정식 공개 지역 아님).
-- 기준점: 인제대학교 35°14′55″N 128°54′09″E (영어 위키백과). 현장에서 다시 확인한다.
-- 음식점 검색은 공개(관리자 로그인 없이 휴대폰으로 시험), 실시간 인기매장은 주문 데이터가 없으므로 비공개.
-- 관리자 '운영 현황 → 서비스 관리 → 지역별 공개 범위'에서 언제든 끌 수 있다.
insert into public.regions (id, name, is_active, search_public, live_public)
values ('gimhae_inje', '김해 인제대학교 주변 (현장 시험)', true, true, false)
on conflict (id) do nothing;

-- 사업자 상권 분석 지역 (사업자 화면에는 비공개, 관리자 시험용)
insert into public.market_areas (id, name, sido, center_lat, center_lng, radius_m, business_visible, sort_order, note)
values ('inje', '김해 인제대 주변 (현장 시험)', '경상남도', 35.248611, 128.9025, 500, false, 10,
        '운영자 현장 시험용. 사업자 공개 전 데이터 확보 필요')
on conflict (id) do nothing;
