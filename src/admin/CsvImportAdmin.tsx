import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readCsvRows } from '../lib/publicData/csv';
import type { SourceCrs } from '../lib/publicData/coords';
import { CsvFormatError, diffWithExisting, planImport, type ImportDiff, type ImportPlan } from '../lib/publicData/importPlan';
import { IMPORT_REGIONS, importRegion, type RegionId } from '../lib/publicData/regions';
import { fetchExisting, stageAndCommit, today, type CommitResult } from './adminApi';
import { kakaoMapPinUrl } from '../lib/mapLinks';

const SOURCE_NAME = '공공데이터포털 전국일반음식점표준데이터';

type Step =
  | { kind: 'idle' }
  | { kind: 'reading'; rows: number }
  | { kind: 'preview'; plan: ImportPlan; diff: ImportDiff }
  | { kind: 'saving'; staged: number; total: number }
  | { kind: 'done'; result: CommitResult; plan: ImportPlan; diff: ImportDiff }
  | { kind: 'error'; message: string };

export function CsvImportAdmin({ client }: { client: SupabaseClient }) {
  const [file, setFile] = useState<File | null>(null);
  const [regionId, setRegionId] = useState<RegionId>('seolleung_yeoksam');
  const [crs, setCrs] = useState<SourceCrs>('EPSG:5174');
  const [collectedAt, setCollectedAt] = useState(today());
  const [step, setStep] = useState<Step>({ kind: 'idle' });

  const analyze = async () => {
    if (!file) return;
    setStep({ kind: 'reading', rows: 0 });
    try {
      const plan = await planImport(readCsvRows(file), {
        region: importRegion(regionId),
        crs,
        onProgress: (rows) => setStep({ kind: 'reading', rows }),
      });
      const existing = await fetchExisting(
        client,
        plan.rows.map((r) => r.licenseNo),
      );
      setStep({ kind: 'preview', plan, diff: diffWithExisting(plan.rows, existing) });
    } catch (e) {
      setStep({
        kind: 'error',
        message: e instanceof CsvFormatError ? e.message : `파일을 처리하지 못했어요: ${(e as Error).message}`,
      });
    }
  };

  const approve = async (plan: ImportPlan, diff: ImportDiff) => {
    if (!file) return;
    setStep({ kind: 'saving', staged: 0, total: plan.rows.length });
    try {
      const result = await stageAndCommit(
        client,
        { fileName: file.name, regionId, sourceName: SOURCE_NAME, collectedAt, clientStats: { ...plan.stats, crs } },
        plan.rows,
        (staged) => setStep({ kind: 'saving', staged, total: plan.rows.length }),
      );
      setStep({ kind: 'done', result, plan, diff });
    } catch (e) {
      setStep({ kind: 'error', message: `저장하지 못했어요. 기존 데이터는 바뀌지 않았어요. (${(e as Error).message})` });
    }
  };

  const busy = step.kind === 'reading' || step.kind === 'saving';

  return (
    <section aria-label="공공데이터 CSV 업로드">
      <div className="admin-card admin-form">
        <h2>공공데이터 CSV 업로드</h2>
        <p className="admin-muted">
          공공데이터포털 ‘전국일반음식점표준데이터’(data.go.kr/data/15096283) CSV를 내려받아 올려 주세요. 전국 파일도
          조각 단위로 읽고 선택한 지역 매장만 남겨요. 메뉴·가격은 만들지 않아요.
        </p>
        <label>
          CSV 파일
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setStep({ kind: 'idle' });
            }}
          />
        </label>
        <div className="admin-row">
          <label>
            등록 지역
            <select value={regionId} disabled={busy} onChange={(e) => setRegionId(e.target.value as RegionId)}>
              {IMPORT_REGIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.primary ? ' (1차)' : ' (확장 예정)'}
                </option>
              ))}
            </select>
          </label>
          <label>
            원본 좌표계
            <select value={crs} disabled={busy} onChange={(e) => setCrs(e.target.value as SourceCrs)}>
              <option value="EPSG:5174">EPSG:5174 (기본)</option>
              <option value="EPSG:2097">EPSG:2097 (경도 보정 없음)</option>
            </select>
          </label>
          <label>
            수집일
            <input type="date" value={collectedAt} disabled={busy} onChange={(e) => setCollectedAt(e.target.value)} />
          </label>
        </div>
        <button type="button" className="admin-btn primary" disabled={!file || busy} onClick={analyze}>
          파일 검사하기
        </button>
      </div>

      {step.kind === 'reading' && <p role="status">파일 읽는 중… {step.rows.toLocaleString('ko-KR')}행</p>}
      {step.kind === 'saving' && (
        <p role="status">
          저장 중… {step.staged.toLocaleString('ko-KR')} / {step.total.toLocaleString('ko-KR')}
        </p>
      )}
      {step.kind === 'error' && (
        <p role="alert" className="admin-error">
          {step.message}
        </p>
      )}
      {step.kind === 'preview' && <Preview plan={step.plan} diff={step.diff} onApprove={() => approve(step.plan, step.diff)} />}
      {step.kind === 'done' && <Result result={step.result} plan={step.plan} />}
    </section>
  );
}

function Preview({ plan, diff, onApprove }: { plan: ImportPlan; diff: ImportDiff; onApprove: () => void }) {
  const s = plan.stats;
  const samples = diff.toInsert.filter((r) => r.coordStatus === 'valid').slice(0, 3);
  const rows: [string, number][] = [
    ['전체 행', s.totalRows],
    ['지역 밖 (건너뜀)', s.outsideRegion],
    ['신규 등록 예정', diff.toInsert.length],
    ['수정 예정', diff.toUpdate.length],
    ['중복 제외 (이미 같은 내용 + 파일 안 중복)', diff.unchanged.length + s.duplicateInFile],
    ['폐업·영업중단 제외', s.closedExcluded],
    ['좌표 오류·누락 (비공개로 분류)', s.coordInvalid + s.coordMissing],
    ['필수값 누락', s.invalidRows],
  ];
  return (
    <section className="admin-card" aria-label="등록 예정 결과 미리보기">
      <h2>등록 예정 결과</h2>
      <table className="admin-table">
        <tbody>
          {rows.map(([k, n]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>{n.toLocaleString('ko-KR')}건</td>
            </tr>
          ))}
        </tbody>
      </table>
      {samples.length > 0 && (
        <div>
          <h3>좌표 확인 (저장 전에 2~3곳을 지도에서 확인해 주세요)</h3>
          <ul>
            {samples.map((r) => (
              <li key={r.licenseNo}>
                {r.name} — {r.roadAddress ?? r.lotAddress}{' '}
                <a href={kakaoMapPinUrl(r.name, r.lat!, r.lng!)} target="_blank" rel="noopener noreferrer">
                  지도에서 보기
                </a>
              </li>
            ))}
          </ul>
          <p className="admin-muted">
            지도 위치가 주소와 약 250m 동서로 어긋나면 원본 좌표계를 EPSG:2097로 바꿔 다시 검사해 보세요.
          </p>
        </div>
      )}
      <details>
        <summary>신규·수정 매장 목록 보기 (최대 50곳)</summary>
        <ul className="admin-preview-list">
          {[...diff.toInsert, ...diff.toUpdate].slice(0, 50).map((r) => (
            <li key={r.licenseNo}>
              {r.name} · {r.category} · {r.roadAddress ?? r.lotAddress ?? '주소 없음'}
              {r.coordStatus !== 'valid' && <strong> (좌표 {r.coordStatus === 'missing' ? '누락' : '오류'})</strong>}
            </li>
          ))}
        </ul>
      </details>
      <button
        type="button"
        className="admin-btn primary"
        disabled={diff.toInsert.length + diff.toUpdate.length === 0}
        onClick={onApprove}
      >
        승인하고 DB에 저장
      </button>
    </section>
  );
}

function Result({ result, plan }: { result: CommitResult; plan: ImportPlan }) {
  const s = plan.stats;
  const rows: [string, number][] = [
    ['신규 등록', result.inserted],
    ['수정', result.updated],
    ['중복 제외', result.unchanged + s.duplicateInFile],
    ['폐업·영업중단 제외', s.closedExcluded],
    ['좌표 오류', s.coordInvalid + s.coordMissing],
    ['최종 등록 성공', result.success],
  ];
  return (
    <section className="admin-card" role="status" aria-label="업로드 결과">
      <h2>업로드 결과</h2>
      <table className="admin-table">
        <tbody>
          {rows.map(([k, n]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>{n.toLocaleString('ko-KR')}건</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="admin-muted">좌표 오류·누락 매장은 비공개로 저장돼요. ‘음식점·메뉴 → 좌표 오류·누락’에서 고칠 수 있어요.</p>
    </section>
  );
}
