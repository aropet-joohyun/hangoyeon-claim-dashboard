export const FIRST_LIVE_MONTH = '2026-09';

export function koreanMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).formatToParts(now);
  return parts.find(p => p.type === 'year').value + '-' + parts.find(p => p.type === 'month').value;
}

export function monthFromTitle(title, kind) {
  const normalized = title.trim();
  let match = /^(20\d{2})(?:\s*년\s*|\s+)(\d{1,2})\s*월$/.exec(normalized)
    || /^(20\d{2})[-./](\d{1,2})$/.exec(normalized);
  if (!match && kind === 'factory') {
    const compact = /^(\d{2})(\d{2})$/.exec(normalized);
    if (compact) match = [compact[0], '20' + compact[1], compact[2]];
  }
  if (!match || +match[2] < 1 || +match[2] > 12) return '';
  return match[1] + '-' + match[2].padStart(2, '0');
}

// Read inert, public tab metadata. Never evaluate scripts from a source sheet.
export function parseSheetCatalog(html, kind) {
  const entries = [...html.matchAll(/items\.push\(\{name:\s*("(?:[^"\\]|\\.)*"),[^}]{0,1500}?\bgid:\s*"(-?\d+)"/g)];
  if (!entries.length) throw new Error('시트 목록 형식을 확인할 수 없습니다.');
  const months = {};
  for (const entry of entries) {
    const title = JSON.parse(entry[1].replace(/\\x([0-9a-f]{2})/gi, '\\u00$1'));
    const month = monthFromTitle(title, kind);
    if (!month) continue;
    (months[month] ||= []).push({ gid: entry[2], title });
  }
  return months;
}

export function monthsThrough(current) {
  const result = [];
  let [year, month] = FIRST_LIVE_MONTH.split('-').map(Number);
  while (`${year}-${String(month).padStart(2, '0')}` <= current) {
    result.push(`${year}-${String(month).padStart(2, '0')}`);
    if (++month === 13) { year++; month = 1; }
  }
  return result;
}

export function catalogURL(source) {
  return source.replace(/\/export\?.*$/, '/htmlview');
}

export function csvURL(source, gid) {
  const url = new URL(source);
  url.searchParams.set('gid', gid);
  return url.href;
}
