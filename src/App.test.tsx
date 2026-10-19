import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from './App';

function cardNames() {
  return within(screen.getByRole('list')).queryAllByText((_, el) => el?.classList.contains('name') ?? false)
    .map((el) => el.textContent);
}

describe('App', () => {
  it('앱 이름, 슬로건, 가상 데이터 안내를 보여준다', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: '뭐먹' })).toBeInTheDocument();
    expect(screen.getByText('지금 다들 뭐 먹어?')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('가상 데이터');
  });

  it('3개 탭이 있고, 배달 탭에서는 반경 선택이 사라진다', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual([
      '🚶 도보 식사',
      '🛵 배달',
      '🛍️ 포장',
    ]);
    expect(screen.getByRole('radiogroup', { name: '검색 반경' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /배달/ }));
    expect(screen.queryByRole('radiogroup', { name: '검색 반경' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /포장/ }));
    expect(screen.getByRole('radiogroup', { name: '검색 반경' })).toBeInTheDocument();
  });

  it('반경 버튼은 30·50·70·100m이고 반경이 넓을수록 결과가 늘어난다', async () => {
    const user = userEvent.setup();
    render(<App />);
    const group = screen.getByRole('radiogroup', { name: '검색 반경' });
    expect(within(group).getAllByRole('radio').map((b) => b.textContent)).toEqual(['30m', '50m', '70m', '100m']);
    await user.click(within(group).getByRole('radio', { name: '30m' }));
    const small = cardNames().length;
    await user.click(within(group).getByRole('radio', { name: '100m' }));
    expect(cardNames().length).toBeGreaterThan(small);
  });

  it('음식 종류와 거리순 정렬이 동작한다', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('radio', { name: '100m' }));
    await user.click(screen.getByRole('radio', { name: '중식' }));
    expect(cardNames()).toEqual(['마라 연구소', '빨간짬뽕집']);
    await user.click(screen.getByRole('radio', { name: '거리순' }));
    expect(cardNames()).toEqual(['빨간짬뽕집', '마라 연구소']);
  });

  it('음식점을 누르면 대표메뉴와 가격이 나타난다', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByRole('searchbox', { name: '음식 검색' }), '짬뽕');
    const head = screen.getByRole('button', { name: /빨간짬뽕집/ });
    expect(head).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('9,000원')).not.toBeInTheDocument();
    await user.click(head);
    expect(head).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('대표메뉴')).toBeInTheDocument();
    expect(screen.getByText('9,000원')).toBeInTheDocument();
    expect(screen.getByText('탕수육 소')).toBeInTheDocument();
  });
});
