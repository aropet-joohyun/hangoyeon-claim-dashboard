// Only the sanitized result of these transformations is sent to the browser.
export const LIVE_MONTH = '2026-09';
export const SOURCES = {
  archive: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSB6-7C1AcN_gkaL4oYZPELWXAho9gfMyxrra012R7tsvXWO-muSGkU5MNSqKDRa47Ro7BfdmGxYDcZ/pub?gid=133932506&single=true&output=csv',
  crm: 'https://docs.google.com/spreadsheets/d/1Ju4GnBA9JtsZZckSWqZ9jRYtblLOLvhXs-upLbUFAK0/export?format=csv&gid=108127051',
  factory: 'https://docs.google.com/spreadsheets/d/16dmX76WWbAyyHQrCnhwrw51bpmkY9n0QQ3Q0r-3gD1Q/export?format=csv&gid=1947637381'
};
const clean = value => String(value ?? '').trim();
const key = value => clean(value).replace(/\s/g, '');

export function parseCSV(text) {
  const rows = []; let row = [], field = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (quoted) throw new Error('CSV 인용부호가 닫히지 않았습니다.');
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function normalizeDate(value) {
  const m = /^(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\s*\.?$/.exec(clean(value));
  if (!m) return '';
  const [year, month, day] = m.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function table(text, required) {
  const rows = parseCSV(text);
  const start = rows.findIndex(row => required.every(header => row.map(key).includes(key(header))));
  if (start < 0) throw new Error('시트 열 구성이 변경되어 집계를 중단했습니다.');
  const columns = rows[start].map(key);
  return rows.slice(start + 1).map(row => Object.fromEntries(columns.filter(Boolean).map(header => [header, clean(row[columns.indexOf(header)])])));
}

export function maskName(value) {
  const chars = [...clean(value)];
  if (!chars.length) return '익명';
  if (chars.length < 3) return chars[0] + '*';
  return chars[0] + '*'.repeat(chars.length - 2) + chars.at(-1);
}
export function maskOrder(value) {
  const order = clean(value);
  return order ? order.slice(0, Math.min(8, Math.max(0, order.length - 4))) + '********' : '—';
}

export function photoURL(value) {
  try {
    const u = new URL(clean(value));
    if (!['drive.google.com', 'docs.google.com'].includes(u.hostname)) return '';
    const id = /\/d\/([\w-]+)/.exec(u.pathname)?.[1] || u.searchParams.get('id');
    return id && /^[\w-]+$/.test(id) ? `https://drive.google.com/file/d/${id}/view` : '';
  } catch { return ''; }
}

function category(product) {
  if (/카사벤토/.test(product)) return '카사벤토';
  if (/카사바/.test(product)) return '카사바';
  if (/두부/.test(product)) return '두부모래';
  if (/벤토나이트/.test(product)) return '벤토나이트';
  return '미분류';
}

export function parseArchive(text) {
  return table(text, ['날짜', '구매처', '제품명', '출처', '유형']).map(r => ({
    date: normalizeDate(r.날짜), store: r.구매처, order: maskOrder(r.주문번호), name: maskName(r.고객명),
    product: r.제품명, cat: r.카테고리 || '미분류', qty: r.수량,
    reason: r.사유, result: r.처리결과, photos: [r.사진1, r.사진2, r.사진3].map(photoURL).filter(Boolean),
    src: r.출처, type: r.유형, courier: r.택배사, memo: r.고객메모 || ''
  })).filter(r => r.date && ['고객 클레임', '파손반송'].includes(r.type));
}

export function parseCRM(text) {
  const sourceRows = table(text, ['날짜', '쇼핑몰', '분류', '상품주문번호', '수령인', '품목']);
  let latestDate = ''; const seen = new Set(); const rows = [];
  for (const r of sourceRows) {
    const date = normalizeDate(r.날짜);
    if (!date.startsWith(LIVE_MONTH) || !key(r.쇼핑몰).startsWith('한고연')) continue;
    if (date > latestDate) latestDate = date;
    // Use the final classification, never a keyword in an unresolved inquiry.
    const classification = key(r.분류);
    if (!['파손', '파손반송'].includes(classification) || !r.품목) continue;
    const uid = r.사건UID;
    // Repeated orders can be separate incidents; deduplicate only a real case ID.
    if (uid && seen.has(uid)) continue;
    if (uid) seen.add(uid);
    rows.push({
      date, store: r.쇼핑몰, order: maskOrder(r.상품주문번호), name: maskName(r.수령인),
      product: r.품목, cat: category(r.품목), qty: r.수량,
      // Free-form CRM notes can contain addresses/phones. Publish classification only.
      reason: classification, result: r.상태 === '처리완료' ? '처리완료' : '처리중',
      photos: [r.첨부이미지1, r.첨부이미지2, r.첨부이미지3].map(photoURL).filter(Boolean),
      src: 'CRM반품', type: classification === '파손' ? '고객 클레임' : '파손반송',
      courier: r.택배사, memo: ''
    });
  }
  return { rows, latestDate };
}

export function summarizeFactory(text) {
  const sourceRows = table(text, ['반송일자', '업체명', '품목', '정상수량', '파손수량']);
  const summary = { month: LIVE_MONTH, records: 0, normalQuantity: 0, damagedQuantity: 0, missingQuantityRecords: 0, latestDate: '' };
  const quantity = value => /^\d+(?:\.\d+)?$/.test(clean(value)) ? Number(value) : null;
  for (const r of sourceRows) {
    const date = normalizeDate(r.반송일자);
    if (!date.startsWith(LIVE_MONTH) || !key(r.업체명).startsWith('한고연') || !r.품목) continue;
    summary.records++;
    if (date > summary.latestDate) summary.latestDate = date;
    const normal = quantity(r.정상수량), damaged = quantity(r.파손수량);
    if (normal === null || damaged === null) summary.missingQuantityRecords++;
    summary.normalQuantity += normal ?? 0;
    summary.damagedQuantity += damaged ?? 0;
  }
  return summary;
}

export function combineRows(archive, crm) {
  // Replace, never append to, September's stale CRM extract. Preserve form records.
  return [...archive.filter(r => !(r.src === 'CRM반품' && r.date.startsWith(LIVE_MONTH))), ...crm];
}

export async function loadDashboard(fetcher = fetch) {
  async function csv(name) {
    const response = await fetcher(SOURCES[name] + '&t=' + Date.now(), { signal: AbortSignal.timeout(20000), cache: 'no-store' });
    if (!response.ok) throw new Error(`${name} HTTP ${response.status}`);
    const text = await response.text();
    if (/^\s*</.test(text)) throw new Error(`${name} CSV 접근 실패`);
    return text;
  }
  const results = await Promise.allSettled([csv('archive'), csv('crm'), csv('factory')]);
  // Never present old September figures as a successful refresh.
  if (results[0].status !== 'fulfilled' || results[1].status !== 'fulfilled') throw new Error('클레임 원본 데이터를 불러오지 못했습니다.');
  const crm = parseCRM(results[1].value);
  const rows = combineRows(parseArchive(results[0].value), crm.rows);
  let factory = null; const warnings = [];
  try {
    if (results[2].status !== 'fulfilled') throw new Error('공장 시트 연결 실패');
    factory = summarizeFactory(results[2].value);
  } catch { warnings.push('공장 반품 원장을 불러오지 못했습니다. 아래 클레임 건수는 CRM 기준입니다.'); }
  return { rows, factory, warnings, liveMonth: LIVE_MONTH, crmLatestDate: crm.latestDate, fetchedAt: new Date().toISOString() };
}
