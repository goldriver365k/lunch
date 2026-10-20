import { BottomSheet } from './BottomSheet';

/** 위치·개인정보 안내 — 실제로 하는 일만 적는다. 정식 처리방침·약관은 사업자 정보 확인 후 게시 */
export function PrivacySheet({ onClose }: { onClose: () => void }) {
  return (
    <BottomSheet title="위치·개인정보 안내" onClose={onClose}>
      <ul className="sheet-list">
        <li>
          <strong>현재 위치</strong>: ‘현재 위치로 찾기’를 누르면 브라우저가 위치 권한을 물어요. 위치는 이 휴대폰에서 거리 계산과 주변 음식점
          검색 요청에만 쓰고, 이동 기록으로 저장하지 않아요.
        </li>
        <li>
          <strong>검색 요청</strong>: 주변 음식점을 찾을 때 검색 기준 좌표를 서버에 보내지만, 서비스 데이터베이스에 저장하지 않아요.
        </li>
        <li>
          <strong>이용 통계</strong>: 방문·검색 횟수를 알기 위해 이 기기에 임의 번호를 저장하고, 가까운 시범 지역 이름(예: 선릉)만 기록해요. 이름·전화번호·좌표는
          기록하지 않으며 180일 뒤 지워요.
        </li>
        <li>
          <strong>회원가입 없음</strong>: 음식점 검색에는 로그인이 필요 없어요.
        </li>
        <li>
          <strong>길찾기</strong>: ‘매장찾기’를 누르면 카카오맵·네이버지도로 출발지·도착지 좌표가 전달돼요. 이후는 해당 지도 서비스의 정책을 따라요.
        </li>
      </ul>
      <p className="sheet-note">위치 권한은 브라우저 설정에서 언제든 끌 수 있어요. 끄면 지역을 직접 골라 검색할 수 있어요.</p>
    </BottomSheet>
  );
}
