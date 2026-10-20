/**
 * 대용량 CSV를 한 번에 메모리에 올리지 않고 조각(chunk) 단위로 읽어 한 행씩 넘겨준다.
 * RFC 4180 따옴표 규칙(쉼표·줄바꿈 포함 값, "" 이스케이프)을 지원한다.
 */

/** 앞부분을 보고 인코딩을 고른다 — 공공데이터 CSV는 CP949(EUC-KR)가 많다 */
export function detectEncoding(head: Uint8Array): 'utf-8' | 'euc-kr' {
  try {
    // stream: true — 끝에서 잘린 다중바이트 문자는 오류로 보지 않는다
    new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: true });
    return 'utf-8';
  } catch {
    return 'euc-kr';
  }
}

export class CsvRowParser {
  private field = '';
  private row: string[] = [];
  private inQuotes = false;
  private quotePending = false;
  private lastWasCR = false;

  /** 텍스트 조각을 넣으면 완성된 행들을 돌려준다 */
  push(text: string): string[][] {
    const rows: string[][] = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (this.quotePending) {
        this.quotePending = false;
        if (ch === '"') {
          this.field += '"';
          continue;
        }
        this.inQuotes = false;
      }
      if (this.inQuotes) {
        if (ch === '"') this.quotePending = true;
        else this.field += ch;
        continue;
      }
      if (this.lastWasCR) {
        this.lastWasCR = false;
        if (ch === '\n') continue;
      }
      if (ch === '"' && this.field === '') this.inQuotes = true;
      else if (ch === ',') this.endField();
      else if (ch === '\n' || ch === '\r') {
        this.lastWasCR = ch === '\r';
        rows.push(this.endRow());
      } else this.field += ch;
    }
    return rows;
  }

  /** 파일 끝 — 남은 행을 돌려준다 */
  end(): string[][] {
    if (this.quotePending) {
      this.quotePending = false;
      this.inQuotes = false;
    }
    if (this.field === '' && this.row.length === 0) return [];
    return [this.endRow()];
  }

  private endField() {
    this.row.push(this.field);
    this.field = '';
  }

  private endRow(): string[] {
    this.endField();
    const r = this.row;
    this.row = [];
    return r;
  }
}

/** 파일을 조각 단위로 읽어 행을 넘겨준다. 빈 행은 건너뛴다. */
export async function* readCsvRows(file: Blob, onProgress?: (bytesRead: number) => void): AsyncGenerator<string[]> {
  const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
  const decoder = new TextDecoder(detectEncoding(head));
  const parser = new CsvRowParser();
  const reader = file.stream().getReader();
  let read = 0;
  let first = true;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    read += value.byteLength;
    let text = decoder.decode(value, { stream: true });
    if (first) {
      text = text.replace(/^\uFEFF/, '');
      first = false;
    }
    for (const row of parser.push(text)) if (row.some((c) => c !== '')) yield row;
    onProgress?.(read);
  }
  for (const row of parser.push(decoder.decode())) if (row.some((c) => c !== '')) yield row;
  for (const row of parser.end()) if (row.some((c) => c !== '')) yield row;
}
