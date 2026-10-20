import type { RouteStep } from '../hooks/useRouteFinder';
import { MAP_PROVIDER_LABEL, type MapProvider } from '../lib/mapLinks';
import { BottomSheet } from './BottomSheet';

interface Props {
  step: RouteStep;
  provider: MapProvider | null;
  onChoose: (p: MapProvider) => void;
  onLocate: () => void;
  onOpenWithoutOrigin: () => void;
  onKakaoWeb: () => void;
  onClose: () => void;
}

/** 매장찾기 흐름의 지도 선택·출발지 안내·네이버 대안 안내 시트 */
export function RouteSheets({ step, provider, onChoose, onLocate, onOpenWithoutOrigin, onKakaoWeb, onClose }: Props) {
  if (step.kind === 'choose') {
    return (
      <BottomSheet title="길찾기에 쓸 지도를 골라 주세요" onClose={onClose}>
        <div className="sheet-actions">
          {(['kakao', 'naver'] as const).map((p) => (
            <button
              key={p}
              type="button"
              className={provider === p ? 'sheet-option active' : 'sheet-option'}
              onClick={() => onChoose(p)}
            >
              {MAP_PROVIDER_LABEL[p]}
              {p === 'kakao' ? <small>웹에서 바로 도보 길찾기</small> : <small>네이버지도 앱으로 도보 길찾기</small>}
            </button>
          ))}
        </div>
        <p className="sheet-note">고른 지도는 이 기기에 기억돼요. ‘지도 변경’에서 언제든 바꿀 수 있어요.</p>
      </BottomSheet>
    );
  }

  if (step.kind === 'no-origin') {
    return (
      <BottomSheet title="실제 출발 위치를 확인하지 못했어요" onClose={onClose}>
        <p className="sheet-text">
          GPS 위치가 없어서 출발지를 임의로 정하지 않았어요. 위치를 확인하거나, 지도에서 출발지를 직접 선택해 주세요.
        </p>
        <div className="sheet-actions">
          <button
            type="button"
            className="sheet-option"
            onClick={() => {
              onLocate();
              onClose();
            }}
          >
            GPS로 출발 위치 확인
            <small>확인 후 매장찾기를 다시 눌러 주세요</small>
          </button>
          <button type="button" className="sheet-option" onClick={onOpenWithoutOrigin}>
            지도에서 출발지 선택
            <small>도착지만 넣어 지도를 열어요</small>
          </button>
        </div>
      </BottomSheet>
    );
  }

  if (step.kind === 'naver-fallback') {
    return (
      <BottomSheet title="네이버지도 앱을 여는 중이에요" onClose={onClose}>
        <p className="sheet-text">
          앱이 열리지 않았다면 네이버지도 앱이 설치되지 않았을 수 있어요. 웹브라우저에서는 설치 여부를 확인할 수 없어서,
          카카오맵 웹 도보 길찾기를 대신 쓸 수 있게 해 두었어요.
        </p>
        <div className="sheet-actions">
          <button type="button" className="sheet-option" onClick={onKakaoWeb}>
            카카오맵 웹으로 도보 길찾기
          </button>
        </div>
      </BottomSheet>
    );
  }

  return null;
}
