import { koreanMonth, parseSheetCatalog, monthsThrough, catalogURL, csvURL, FIRST_LIVE_MONTH } from './month-sources.js';
// Only the sanitized result of these transformations is sent to the browser.
export const LIVE_MONTH = FIRST_LIVE_MONTH;
export const SOURCES = {
  archive: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSB6-7C1AcN_gkaL4oYZPELWXAho9gfMyxrra012R7tsvXWO-muSGkU5MNSqKDRa47Ro7BfdmGxYDcZ/pub?gid=133932506&single=true&output=csv',
  crm: 'https://docs.google.com/spreadsheets/d/1Ju4GnBA9JtsZZckSWqZ9jRYtblLOLvhXs-upLbUFAK0/export?format=csv&gid=108127051',
  photos: 'https://docs.google.com/spreadsheets/d/1Ml8mKk-HxHhdNL3USHUfDPcj7cw0-E-xo2P6tKzCm1w/export?format=csv&gid=1594296749',
  factory: 'https://docs.google.com/spreadsheets/d/16dmX76WWbAyyHQrCnhwrw51bpmkY9n0QQ3Q0r-3gD1Q/export?format=csv&gid=1947637381'
};
const clean = value => String(value ?? '').trim();
const key = value => clean(value).replace(/\s/g, '');
// Internal join key: Symbol properties are omitted from the JSON response.
const MATCH_ORDER = Symbol('sourceOrder');
const orderKey = value => /^\d{10,}$/.test(key(value)) ? key(value) : '';

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

export function parseCRM(text, month = LIVE_MONTH) {
  const sourceRows = table(text, ['날짜', '쇼핑몰', '분류', '상품주문번호', '수령인', '품목']);
  let latestDate = ''; const seen = new Set(); const rows = [];
  for (const r of sourceRows) {
    const date = normalizeDate(r.날짜);
    if (!date.startsWith(month) || !key(r.쇼핑몰).startsWith('한고연')) continue;
    if (date > latestDate) latestDate = date;
    // Use the final classification, never a keyword in an unresolved inquiry.
    const classification = key(r.분류);
    if (!['파손', '파손반송'].includes(classification) || !r.품목) continue;
    const uid = r.사건UID;
    // Repeated orders can be separate incidents; deduplicate only a real case ID.
    if (uid && seen.has(uid)) continue;
    if (uid) seen.add(uid);
    rows.push({
      [MATCH_ORDER]: orderKey(r.상품주문번호),
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

export function parsePhotoForms(text, month = LIVE_MONTH) {
  return table(text, ['날짜', '구매처', '상품주문번호', '고객명', '제품명', '사진1', '사진2', '사진3'])
    .filter(r => normalizeDate(r.날짜).startsWith(month) && key(r.구매처).startsWith('한고연'))
    .map(r => ({
      [MATCH_ORDER]: orderKey(r.상품주문번호),
      date: normalizeDate(r.날짜), store: r.구매처, order: maskOrder(r.상품주문번호), name: maskName(r.고객명),
      product: r.제품명, cat: r.카테고리 || '미분류', qty: r.수량,
      reason: ['박스 및 제품 포장지 모두 파손', '제품 포장지 파손', '박스 파손'].includes(r.사유) ? r.사유 : '파손 사진 접수',
      result: '', src: '클레임폼', memo: '',
      photos: [...new Set([r.사진1, r.사진2, r.사진3].map(photoURL).filter(Boolean))]
    })).filter(r => r.product && r.photos.length);
}

function productIdentity(value) {
  const normalized = key(value).replaceAll('아메리칸솔루션', '아메솔').replace(/[-_,\[\]()]/g, '').toLowerCase();
  const weights = [...new Set(normalized.match(/\d+(?:\.\d+)?(?:kg|ml|g|l)/g) || [])].sort().join('|');
  // Require an identifiable product line AND matching pack weight. Never join on
  // a masked order prefix, customer name, or broad category such as "카사바".
  const lines = [
    ['아메솔', '옵티멈'], ['아메솔', '실크니스'], ['아메솔', '그랜드마스터'],
    ['캐네디언샌드', '카사벤토'], ['캐네디언샌드'], ['앤샌드', '베이직'],
    ['모래혁명', '이노베이션'], ['미스터리', '오더킬러', '네이쳐'],
    ['미스터리', '두부킬러', '그린티'], ['미스터리', '두부킬러', '오리지널']
  ];
  const line = lines.find(tokens => tokens.every(token => normalized.includes(token)));
  return line && weights ? line.join('|') + '|' + weights : normalized;
}

export function attachPhotoForms(crmRows, forms, month = LIVE_MONTH) {
  const rows = crmRows.map(row => ({ ...row, photos: [...row.photos] }));
  const unlinked = []; let linked = 0;
  for (const form of forms) {
    const candidates = rows.filter(row => row.type === '고객 클레임' && form[MATCH_ORDER] && row[MATCH_ORDER] === form[MATCH_ORDER]
      && productIdentity(row.product) === productIdentity(form.product)
      && Math.abs(Date.parse(row.date) - Date.parse(form.date)) <= 86400000);
    if (candidates.length !== 1) {
      unlinked.push({ ...form, matchNote: candidates.length > 1 ? '연결 후보가 여러 건입니다.' : 'CRM 주문번호·상품·접수일 확인이 필요합니다.' });
      continue;
    }
    const row = candidates[0];
    row.photos = [...new Set([...row.photos, ...form.photos])];
    row.photoFormDates = [...new Set([...(row.photoFormDates || []), form.date])];
    if (form.cat !== '미분류') row.cat = form.cat;
    linked++;
  }
  return { rows, unlinked, summary: {
    status: 'ready', month, submissions: forms.length, linkedSubmissions: linked,
    unlinkedSubmissions: unlinked.length, photos: new Set(forms.flatMap(r => r.photos)).size,
    latestDate: forms.map(r => r.date).sort().at(-1) || ''
  } };
}

export function summarizeFactory(text, month = LIVE_MONTH) {
  // October's source has a numeric value in the first (return-date) header.
  // Recover only the verified layout; never mistake ERP processing dates for returns.
  const raw = parseCSV(text);
  const headerIndex = raw.findIndex(row => ['업체명', '품목', '정상수량', '파손수량'].every(h => row.map(key).includes(h)));
  if (headerIndex >= 0 && /^\d+$/.test(key(raw[headerIndex][0]))
      && raw.slice(headerIndex + 1).some(row => normalizeDate(row[0]))) {
    raw[headerIndex][0] = '반송일자';
    text = raw.map(row => row.map(v => '"' + v.replaceAll('"', '""') + '"').join(',')).join('\n');
  }
  const sourceRows = table(text, ['반송일자', '업체명', '품목', '정상수량', '파손수량']);
  const summary = { month, records: 0, normalQuantity: 0, damagedQuantity: 0, missingQuantityRecords: 0, latestDate: '' };
  const quantity = value => /^\d+(?:\.\d+)?$/.test(clean(value)) ? Number(value) : null;
  for (const r of sourceRows) {
    const date = normalizeDate(r.반송일자);
    if (!date.startsWith(month) || !key(r.업체명).startsWith('한고연') || !r.품목) continue;
    summary.records++;
    if (date > summary.latestDate) summary.latestDate = date;
    const normal = quantity(r.정상수량), damaged = quantity(r.파손수량);
    if (normal === null || damaged === null) summary.missingQuantityRecords++;
    summary.normalQuantity += normal ?? 0;
    summary.damagedQuantity += damaged ?? 0;
  }
  return summary;
}

export function combineRows(archive, crm, month = LIVE_MONTH) {
  // Replace, never append to, September's stale CRM extract. Preserve form records.
  return [...archive.filter(r => !(r.src === 'CRM반품' && r.date.startsWith(month))), ...crm];
}

export async function loadDashboard(fetcher = fetch, month = LIVE_MONTH, sourceURLs = SOURCES) {
  async function csv(name) {
    const source = sourceURLs[name];
    const response = await fetcher(source + '&t=' + Date.now(), { signal: AbortSignal.timeout(20000), cache: 'no-store' });
    if (!response.ok) throw new Error(`${name} HTTP ${response.status}`);
    const text = await response.text();
    if (/^\s*</.test(text)) throw new Error(`${name} CSV 접근 실패`);
    return text;
  }
  const results = await Promise.allSettled([csv('archive'), csv('crm'), csv('factory'), csv('photos')]);
  // Never present old September figures as a successful refresh.
  if (results[0].status !== 'fulfilled' || results[1].status !== 'fulfilled') throw new Error('클레임 원본 데이터를 불러오지 못했습니다.');
  const crm = parseCRM(results[1].value, month);
  let factory = null; const warnings = [];
  let photoResult = { rows: crm.rows, unlinked: [], summary: { status: 'unavailable', month } };
  try {
    if (results[3].status !== 'fulfilled') throw new Error('사진 시트 연결 실패');
    photoResult = attachPhotoForms(crm.rows, parsePhotoForms(results[3].value, month), month);
  } catch { warnings.push('사진 접수 원본을 불러오지 못했습니다. 사진 수량은 확인 불가이며, CRM 접수 건수만 표시합니다.'); }
  const rows = combineRows(parseArchive(results[0].value), photoResult.rows, month);
  try {
    if (results[2].status !== 'fulfilled') throw new Error('공장 시트 연결 실패');
    factory = summarizeFactory(results[2].value, month);
  } catch { warnings.push('공장 반품 원장을 불러오지 못했습니다. 아래 클레임 건수는 CRM 기준입니다.'); }
  return { rows, factory, photoSummary: photoResult.summary, unlinkedPhotos: photoResult.unlinked,
    warnings, liveMonth: month, crmLatestDate: crm.latestDate, fetchedAt: new Date().toISOString() };
}

export async function loadAllMonths(fetcher = fetch, now = new Date()) {
  const current = koreanMonth(now), months = monthsThrough(current);
  const deadline = AbortSignal.timeout(45000);
  async function read(url, html = false) {
    const response = await fetcher(url + (url.includes('?') ? '&' : '?') + 't=' + now.getTime(), {
      signal: AbortSignal.any([deadline, AbortSignal.timeout(15000)]), cache: 'no-store'
    });
    if (!response.ok) throw new Error('원본 조회 실패');
    const text = await response.text();
    if (!html && /^\s*</.test(text)) throw new Error('CSV 조회 실패');
    return text;
  }
  const [archive, photos, crmCatalog, factoryCatalog] = await Promise.allSettled([
    read(SOURCES.archive), read(SOURCES.photos),
    read(catalogURL(SOURCES.crm), true).then(h => parseSheetCatalog(h, 'crm')),
    read(catalogURL(SOURCES.factory), true).then(h => parseSheetCatalog(h, 'factory'))
  ]);
  if (archive.status !== 'fulfilled') throw new Error('기존 집계 원본 조회 실패');
  // The archive is authoritative only before live integration began.
  const archivedRows = parseArchive(archive.value).filter(r => r.date.slice(0, 7) < FIRST_LIVE_MONTH);
  async function report(month) {
    const status = { crm: 'pending', factory: 'pending', photos: 'unavailable' };
    const warnings = [];
    let rows = [], latestDate = '', factory = null;
    let photoResult = { rows: [], unlinked: [], summary: { month, status: 'unavailable' } };
    const crmTabs = crmCatalog.status === 'fulfilled' ? crmCatalog.value[month] || [] : null;
    const factoryTabs = factoryCatalog.status === 'fulfilled' ? factoryCatalog.value[month] || [] : null;
    const tasks = [
      (async () => {
        if (crmTabs === null || crmTabs.length > 1) { status.crm = 'unavailable'; return; }
        if (!crmTabs.length) return;
        try {
          const crm = parseCRM(await read(csvURL(SOURCES.crm, crmTabs[0].gid)), month);
          rows = crm.rows; latestDate = crm.latestDate; status.crm = 'ready';
        } catch { status.crm = 'unavailable'; }
      })(),
      (async () => {
        if (factoryTabs === null || factoryTabs.length > 1) { status.factory = 'unavailable'; return; }
        if (!factoryTabs.length) return;
        try {
          factory = summarizeFactory(await read(csvURL(SOURCES.factory, factoryTabs[0].gid)), month);
          status.factory = 'ready';
        } catch { status.factory = 'unavailable'; }
      })()
    ];
    await Promise.all(tasks);
    try {
      if (photos.status !== 'fulfilled') throw new Error('사진 조회 실패');
      photoResult = attachPhotoForms(rows, parsePhotoForms(photos.value, month), month);
      status.photos = 'ready';
    } catch { warnings.push(month + ' 사진 원본 연결 오류 · 사진 수량 확인 불가'); }
    if (status.crm !== 'ready') warnings.push(month + (status.crm === 'pending' ? ' CRM 시트 준비 중' : ' CRM 연결 오류 또는 중복 월 시트 · 건수 확인 불가'));
    if (status.factory !== 'ready') warnings.push(month + (status.factory === 'pending' ? ' 공장 시트 준비 중' : ' 공장 원장 연결 오류 · 수량 확인 불가'));
    return { month, rows: photoResult.rows.length ? photoResult.rows : rows, latestDate, factory, photoResult, status, warnings };
  }
  // Bound source concurrency as history grows; each pair fetches at most four CSVs.
  const reports = [];
  for (let i = 0; i < months.length; i += 2) reports.push(...await Promise.all(months.slice(i, i + 2).map(report)));
  const latest = reports.at(-1);
  const rows = [...archivedRows, ...reports.flatMap(r => r.rows)];
  return { rows, liveMonth: current, liveMonths: months, fetchedAt: now.toISOString(),
    crmLatestDate: latest?.latestDate || '', factory: latest?.factory || null,
    photoSummary: latest?.photoResult.summary || { month: current, status: 'unavailable' },
    factories: Object.fromEntries(reports.map(r => [r.month, r.factory])),
    photoSummaries: Object.fromEntries(reports.map(r => [r.month, r.photoResult.summary])),
    monthStatuses: Object.fromEntries(reports.map(r => [r.month, r.status])),
    unlinkedPhotos: reports.flatMap(r => r.photoResult.unlinked), warnings: reports.flatMap(r => r.warnings) };
}
