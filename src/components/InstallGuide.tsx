import { useEffect, useState } from 'react';
import { installPlatform, type InstallPlatform } from '../lib/pwa';
import { BottomSheet } from './BottomSheet';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * 홈 화면에 추가 — 안드로이드 크롬 등은 설치 창, 아이폰은 공유 메뉴 안내.
 * iOS에는 자동 설치 창이 없어 억지로 띄우지 않는다. 이미 설치해 실행 중이면 보이지 않는다.
 */
export function InstallGuide({ onInstalled }: { onInstalled?: () => void }) {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [open, setOpen] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // 브라우저 기본 배너 대신 아래 버튼으로
      setPrompt(e as BeforeInstallPromptEvent);
    };
    const onDone = () => {
      setInstalled(true);
      setPrompt(null);
      onInstalled?.();
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onDone);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onDone);
    };
  }, [onInstalled]);

  const platform: InstallPlatform = installed ? 'installed' : installPlatform(navigator.userAgent, !!prompt);
  if (platform === 'installed') return null;

  const click = async () => {
    if (prompt) {
      await prompt.prompt();
      const choice = await prompt.userChoice.catch(() => null);
      if (choice?.outcome === 'accepted') setPrompt(null);
      return;
    }
    setOpen(true);
  };

  return (
    <>
      <button type="button" className="link-button inline" onClick={click}>
        홈 화면에 추가
      </button>
      {open && (
        <BottomSheet title="홈 화면에 추가" onClose={() => setOpen(false)}>
          {platform === 'ios' ? (
            <ol className="sheet-steps">
              <li>Safari 아래(또는 위)의 공유 버튼 <span aria-hidden="true">⎙</span>을 눌러요.</li>
              <li>‘홈 화면에 추가’를 고르고 ‘추가’를 눌러요.</li>
              <li>홈 화면의 ‘점심뭐먹’ 아이콘으로 바로 열 수 있어요.</li>
            </ol>
          ) : platform === 'android-menu' ? (
            <ol className="sheet-steps">
              <li>브라우저 오른쪽 위 메뉴(⋮)를 눌러요.</li>
              <li>‘홈 화면에 추가’ 또는 ‘앱 설치’를 골라요.</li>
            </ol>
          ) : (
            <p className="sheet-text">브라우저 메뉴에서 ‘홈 화면에 추가’ 또는 ‘앱 설치’를 골라 주세요. 지원하지 않는 브라우저도 있어요.</p>
          )}
          <p className="sheet-note">앱스토어 설치 없이 이 웹앱을 홈 화면에서 바로 열 수 있어요.</p>
        </BottomSheet>
      )}
    </>
  );
}
