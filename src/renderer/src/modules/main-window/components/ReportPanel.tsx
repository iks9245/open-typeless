import { useEffect, useRef, useState } from 'react';
import type { SpeechReport } from '../../../../../shared/types/report';
import { useSettings } from '../hooks/SettingsContext';
import { useReport } from '../hooks/useReport';
import { usePolishStatus } from '../hooks/usePolishStatus';
import { errorMessage, formatReportDuration, formatReportNumber, polishReasonLabel } from '../lib/format';

const n = formatReportNumber;

function Stat({ id, label, value, current, previous, duration = false, note }: {
  id: string; label: string; value: string; current?: number; previous?: number; duration?: boolean; note?: string;
}) {
  const delta = current === undefined || previous === undefined ? null : current - previous;
  return <div className="card report-stat" data-testid={`report-stat-${id}`}>
    <span className="muted">{label}</span><strong>{value}</strong>
    {delta !== null && <span className="report-change muted">{delta === 0 ? '與前期相同' : `${delta > 0 ? '▲' : '▼'} ${duration ? formatReportDuration(Math.abs(delta)) : n(Math.abs(delta))}（較前期）`}</span>}
    {note && <small className="muted">{note}</small>}
  </div>;
}

function ActivityChart({ values, peak, labels, id, label }: {
  values: number[]; peak?: number | null; labels: string[]; id: string; label: string;
}) {
  const maximum = Math.max(1, ...values);
  return <div className="report-chart" data-testid={id} role="img" aria-label={label}>
    {values.map((count, index) => <div className="report-chart-column" key={index}>
      <div className="report-chart-track" title={`${id === 'report-hours' ? `${n(index)} 時` : `週${labels[index]}`}：${n(count)} 次`}>
        <div className={`report-chart-bar${peak === index ? ' report-peak' : ''}`} style={{ height: `${count / maximum * 100}%` }} />
      </div>
      <span className="muted">{labels[index] || '\u00a0'}</span>
    </div>)}
  </div>;
}

function ReportDetails({ report }: { report: SpeechReport }) {
  const { previous } = report;
  const largest = report.fillers.top[0]?.spoken ?? 1;
  return <>
    <div className="report-stats">
      <Stat id="dictations" label="聽寫次數" value={n(report.dictations)} current={report.dictations} previous={previous?.dictations} />
      <Stat id="characters" label="字數" value={n(report.characters)} current={report.characters} previous={previous?.characters} />
      <Stat id="speaking" label="說話時間" value={formatReportDuration(report.speakingMs)} />
      <Stat id="saved" label="省下時間" value={formatReportDuration(report.savedMs)} current={report.savedMs} previous={previous?.savedMs} duration note="以每分鐘打 40 字估算" />
      <Stat id="speed" label="語速（字／分鐘）" value={report.charactersPerMinute === null ? '—' : n(report.charactersPerMinute)} />
    </div>
    <p className="muted report-command-count">另有 {n(report.commands)} 次指令；指令計入活動總量，不計入口頭禪、更正與常用詞。</p>
    <section className="card report-section" aria-labelledby="report-fillers-heading">
      <h2 id="report-fillers-heading">你的口頭禪排行榜</h2>
      <ol className="report-fillers" data-testid="report-fillers">{report.fillers.top.map(item => <li key={item.term}>
        <div className="report-filler-label"><strong>{item.term}</strong><span>{n(item.spoken)} 次 · AI 刪掉 {n(item.removed)} 次</span></div>
        <div className="report-filler-track"><div style={{ width: `${item.spoken / largest * 100}%` }} /></div>
      </li>)}</ol>
      {report.fillers.top.length === 0 && <p className="muted">沒有發現這些口頭禪。</p>}
      <p className="muted help">共 {n(report.fillers.total)} 次，AI 刪掉 {n(report.fillers.removedTotal)} 次。</p>
      <p className="muted help">『那個』『就是』也可能是正常用法，數字僅供參考。</p>
      <p className="report-corrections" data-testid="report-corrections">自我更正：{n(report.corrections)} 次</p>
    </section>
    <div className="report-chart-grid">
      <section className="card report-section" aria-labelledby="report-hours-heading">
        <h2 id="report-hours-heading">最常開口的時段</h2>
        <p className="muted help">{report.peakHour === null ? '還沒有聽寫活動' : `高峰：${n(report.peakHour)} 時`}</p>
        <ActivityChart id="report-hours" values={report.hours} peak={report.peakHour}
          labels={report.hours.map((_, hour) => hour % 6 === 0 ? n(hour) : '')}
          label={report.hours.map((count, hour) => `${n(hour)} 時 ${n(count)} 次聽寫`).join('，')} />
      </section>
      <section className="card report-section" aria-labelledby="report-weekdays-heading">
        <h2 id="report-weekdays-heading">一週活動</h2>
        <ActivityChart id="report-weekdays" values={report.weekdays} labels={['一', '二', '三', '四', '五', '六', '日']}
          label={report.weekdays.map((count, day) => `週${['一', '二', '三', '四', '五', '六', '日'][day]} ${n(count)} 次`).join('，')} />
      </section>
    </div>
    <section className="card report-section" aria-labelledby="report-words-heading">
      <h2 id="report-words-heading">最常用的詞</h2>
      <ul className="report-words" data-testid="report-words">{report.words.map(item => <li key={item.word}>{item.word} <span className="muted">{n(item.count)}</span></li>)}</ul>
      {report.words.length === 0 && <p className="muted">還沒有足夠的詞彙。</p>}
    </section>
  </>;
}

export function ReportPanel({ active }: { active: boolean }) {
  const [range, setRange] = useState<SpeechReport['range']>('week');
  const { report, error, pending, refresh } = useReport(range, active);
  const { settings } = useSettings();
  const polish = usePolishStatus(active);
  const [comment, setComment] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const [commenting, setCommenting] = useState(false);
  const commentRequest = useRef(0);
  const busy = useRef(false);

  useEffect(() => {
    commentRequest.current++;
    busy.current = false;
    setComment('');
    setCommentError(null);
    setCommenting(false);
    // Ignore commentary for an older report, range, or tab visit.
    return () => { commentRequest.current++; };
  }, [report, active, range]);

  const requestComment = async () => {
    if (busy.current) return;
    busy.current = true;
    const request = ++commentRequest.current;
    setCommenting(true);
    setComment('');
    setCommentError(null);
    try {
      const result = await window.api.report.comment({ range });
      if (request !== commentRequest.current) return;
      if (result.success === false) throw new Error(result.error);
      setComment(result.data.text);
    } catch (error) {
      if (request === commentRequest.current) setCommentError(`點評失敗：${errorMessage(error)}`);
    } finally {
      if (request === commentRequest.current) {
        busy.current = false;
        setCommenting(false);
      }
    }
  };

  const empty = report !== null && report.dictations + report.commands === 0;
  return <div className="panel-content" aria-busy={pending}>
    <div className="section-heading"><div><h1>口頭禪報告</h1><p className="muted">從聽寫紀錄，認識你的說話習慣。統計在本機計算。</p></div>
      <label><span className="sr-only">報告期間</span><select data-testid="report-range" value={range} onChange={event => {
        const value = event.target.value;
        if (value === 'week' || value === 'month' || value === 'all') setRange(value);
      }}><option value="week">本週</option><option value="month">本月</option><option value="all">全部</option></select></label>
    </div>
    {settings?.history.enabled === false && <p className="notice" data-testid="report-history-disabled">歷史紀錄已停用，新的聽寫不會保存。此報告仍包含現有紀錄。</p>}
    {error && <div className="notice error-text" role="alert">{error}<button onClick={() => { void refresh(); }}>重試</button></div>}
    {pending && !report && <p className="muted" role="status">正在整理報告…</p>}
    {report && <>
      <p className="report-headline" data-testid="report-headline">{report.headline}</p>
      {empty ? <div className="empty-state" data-testid="report-empty"><h2>開始累積你的說話習慣</h2><p>這段期間還沒有聽寫紀錄，試試其他期間或開始聽寫。</p></div> : <ReportDetails report={report} />}
    </>}
    <section className="card report-section" aria-labelledby="report-comment-heading">
      <div className="section-heading"><h2 id="report-comment-heading">說話教練的小點評</h2>
        <button data-testid="report-comment" disabled={!report || empty || pending || commenting || polish.error !== null || polish.status?.available !== true}
          onClick={() => { void requestComment(); }}>{commenting && <span className="report-spinner" aria-hidden="true" />}{commenting ? '點評中…' : '讓 AI 評一評'}</button>
      </div>
      <p className="muted help">AI 只會收到統計數字、口頭禪與高峰時段，不含聽寫原文或常用詞。</p>
      {polish.error ? <p className="error-text" role="alert">{polish.error}</p>
        : polish.status?.available === false && <p className="muted help">{polishReasonLabel(polish.status.reason)}</p>}
      {commenting && <p role="status">正在請教說話教練…</p>}
      {comment && <p className="report-comment-text" data-testid="report-comment-text" role="status">{comment}</p>}
      {commentError && <p className="error-text" role="alert">{commentError}</p>}
    </section>
  </div>;
}
