export function fmtTime(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '없음';
}

export function won(n: number | null | undefined): string {
  return `${Math.round(Number(n ?? 0)).toLocaleString('ko-KR')}원`;
}
