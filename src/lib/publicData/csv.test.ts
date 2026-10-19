// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CsvRowParser, detectEncoding, readCsvRows } from './csv';

describe('CsvRowParser', () => {
  it('따옴표 안의 쉼표·줄바꿈·"" 이스케이프와 CRLF를 처리한다', () => {
    const p = new CsvRowParser();
    const rows = [...p.push('a,"b,1","c ""q"""\r\n"multi\r\nline",x,\r\n'), ...p.end()];
    expect(rows).toEqual([
      ['a', 'b,1', 'c "q"'],
      ['multi\r\nline', 'x', ''],
    ]);
  });

  it('조각 경계가 어디서 잘려도 같은 결과', () => {
    const text = 'h1,h2\r\n"x,""y""",2\r\n3,4';
    const whole = (() => {
      const p = new CsvRowParser();
      return [...p.push(text), ...p.end()];
    })();
    for (let cut = 1; cut < text.length; cut++) {
      const p = new CsvRowParser();
      expect([...p.push(text.slice(0, cut)), ...p.push(text.slice(cut)), ...p.end()]).toEqual(whole);
    }
  });
});

describe('readCsvRows', () => {
  const bytes = readFileSync(new URL('./__fixtures__/sample_cp949.csv', import.meta.url));

  it('CP949(EUC-KR) 파일을 알아본다', () => {
    expect(detectEncoding(new Uint8Array(bytes))).toBe('euc-kr');
    expect(detectEncoding(new TextEncoder().encode('관리번호,사업장명'))).toBe('utf-8');
  });

  it('파일을 조각 단위로 읽어 한글 행을 돌려준다', async () => {
    const rows: string[][] = [];
    for await (const r of readCsvRows(new Blob([bytes]))) rows.push(r);
    expect(rows[0]).toContain('사업장명');
    expect(rows).toHaveLength(13);
    expect(rows[12][11]).toBe('시험식당 "따옴표, 쉼표"');
  });
});
