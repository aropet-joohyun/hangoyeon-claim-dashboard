import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAllMonths } from '../lib/claim-data.js';
import { parseCSV, normalizeDate, parseArchive, parseCRM, combineRows, summarizeFactory, loadDashboard, photoURL, parsePhotoForms, attachPhotoForms } from '../lib/claim-data.js';

const csv = rows => rows.map(row => row.map(v => '"' + String(v ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n');
const crmHeaders = ['날짜', '쇼핑몰', '분류', '상품주문번호', '수령인', '품목', '수량', '사유', '연락처', '재출고', '첨부이미지1', '사건UID'];
const archiveHeaders = ['날짜', '구매처', '주문번호', '고객명', '제품명', '카테고리', '수량', '사유', '처리결과', '사진1', '사진2', '사진3', '출처', '유형', '택배사', '고객메모'];
const factoryHeaders = ['반송일자', '업체명', '품목', '정상\n수량', '파손\n수량', 'CS 비고'];
const archive = csv([archiveHeaders, ['2026-08-03','한고연스스','2026080312345678','김*수','모래','','1','','','','','','CRM반품','파손반송']]);
const crm = csv([[],[],[],[],crmHeaders,['2026. 9. 16','한고연스스','파손','2026091612345678','김철수','카사바 6kg','2','010-1234-5678 서울시 상세주소','010-1234-5678','서울시 상세주소','','CASE-1']]);
const factory = csv([factoryHeaders, ['2026.09.16','한고연스스','모래','2','1','파손반송']]);
const photoHeaders = ['날짜','구매처','상품주문번호','고객명','제품명','카테고리','수량','사진1','사진2','사진3','고객메모'];
const photos = csv([photoHeaders]);

test('October loads its own tabs while September remains intact', async () => {
  const requested = [];
  const data = await loadAllMonths(async url => {
    requested.push(url);
    if (url.includes('gid=23809276')) return new Response(crm.replaceAll('2026. 9. 16', '2026. 10. 16'));
    if (url.includes('gid=24962578')) return new Response(factory.replaceAll('2026.09.16', '2026.10.16'));
    return fetcher()(url);
  });
  assert.equal(data.liveMonth, '2026-10');
  assert.deepEqual(data.rows.map(r => r.date).sort(), ['2026-08-03', '2026-09-16', '2026-10-16']);
  for (const month of ['2026-09', '2026-10']) {
    assert.equal(data.factories[month].records, 1);
    assert.equal(data.photoSummaries[month].month, month);
  }
  assert.ok(requested.some(url => url.includes('gid=23809276')));
  assert.ok(requested.some(url => url.includes('gid=24962578')));
});

test('October photo forms are selected independently of September', () => {
  const text = csv([photoHeaders,
    ['2026-09-16','한고연스스','2026091612345678','김철수','모래','','1','https://drive.google.com/open?id=sep'],
    ['2026-10-16','한고연스스','2026101612345678','김철수','모래','','1','https://drive.google.com/open?id=oct']]);
  const rows = parsePhotoForms(text, '2026-10');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, '2026-10-16');
});

test('CSV keeps quoted multiline fields, commas, escaped quotes and Korean BOM headers', () => {
  assert.deepEqual(parseCSV('\uFEFF' + csv([['날짜','사유'],['2026. 9. 2','문의, "파손"\n>교환']])), [['날짜','사유'],['2026. 9. 2','문의, "파손"\n>교환']]);
  assert.throws(() => parseCSV('"truncated'));
});
test('both observed date formats are accepted; impossible dates are rejected', () => {
  for (const date of ['2026.09.02','2026. 9. 2','2026-09-02','2026/9/2']) assert.equal(normalizeDate(date),'2026-09-02');
  for (const date of ['2026.02.30','2026.13.01','합계','9/2']) assert.equal(normalizeDate(date),'');
});
test('CRM uses final category, correct shop and month, not words in inquiry notes', () => {
  const text=csv([crmHeaders,
    ['2026. 9. 2','한고연스스','파손','1','김철수','모래'],
    ['2026. 9. 2','한고연몰','파손반송','2','김철수','모래'],
    ['2026. 9. 2','한고연스스','반품','3','김철수','모래','1','파손 의심 > 정상배송'],
    ['2026. 9. 2','다른몰','파손','4','김철수','모래'],
    ['2026. 8. 2','한고연스스','파손','5','김철수','모래']]);
  assert.deepEqual(parseCRM(text).rows.map(r=>r.type),['고객 클레임','파손반송']);
});
test('headers can move, including line breaks; missing required headers fail visibly', () => {
  const headers=['품목','수령인','상품\n주문번호','분류','쇼핑몰','날짜'];
  assert.equal(parseCRM(csv([headers,['모래','김철수','1234567890','파손','한고연스스','2026.9.2']])).rows.length,1);
  assert.throws(()=>parseCRM('날짜,다른열\n2026.9.2,1'));
});
test('CRM strips raw names, orders, phones, addresses and free-form notes', () => {
  const result=parseCRM(crm).rows[0], encoded=JSON.stringify(result);
  assert.equal(result.name,'김*수'); assert.equal(result.order,'20260916********');
  for (const value of ['김철수','2026091612345678','010-1234-5678','서울시','CASE-1']) assert.ok(!encoded.includes(value));
  assert.equal(result.reason,'파손');
});
test('real case IDs deduplicate but separate incidents on the same order survive', () => {
  const r=['2026.9.2','한고연스스','파손','1234567890','김철수','모래','1','','','','','CASE-A'];
  assert.equal(parseCRM(csv([crmHeaders,r,r,[...r.slice(0,11),'CASE-B']])).rows.length,2);
  assert.equal(parseCRM(csv([crmHeaders,r.slice(0,11),r.slice(0,11)])).rows.length,2);
});
test('refresh replaces stale September CRM rows even when latest result is zero', () => {
  const prior=[{date:'2026-08-01',src:'CRM반품'},{date:'2026-09-02',src:'CRM반품'},{date:'2026-09-02',src:'클레임폼'}];
  assert.deepEqual(combineRows(prior,[]),[prior[0],prior[2]]);
  assert.equal(combineRows(prior,[{date:'2026-09-16',src:'CRM반품'}]).length,3);
});
test('factory figures stay separate; blank quantities and other shops are handled', () => {
  const data=summarizeFactory(csv([factoryHeaders,
    ['2026.9.16','한고연스스','모래','2','1'],
    ['2026.9.16','한고연스스','사료','','','회수불가'],
    ['2026.9.16','다른몰','모래','50','50'],
    ['2026.8.16','한고연스스','모래','50','50']]));
  assert.equal(data.records,2); assert.equal(data.normalQuantity,2); assert.equal(data.damagedQuantity,1); assert.equal(data.missingQuantityRecords,1);
});
test('photo URLs accept Drive IDs and reject unsafe or unrelated destinations',()=>{
  assert.equal(photoURL('https://drive.google.com/open?id=photo_123'),'https://drive.google.com/file/d/photo_123/view');
  for(const value of ['javascript:alert(1)','https://evil.example/d/a','https://drive.google.com.evil.example/d/a'])assert.equal(photoURL(value),'');
});
test('October factory numeric date header is recovered only with a verified layout', () => {
  const headers = [...factoryHeaders]; headers[0] = '582136';
  const result = summarizeFactory(csv([headers, ['2026.10.16','한고연스스','모래','2','1']]), '2026-10');
  assert.equal(result.records, 1);
  assert.equal(result.latestDate, '2026-10-16');
  assert.throws(() => summarizeFactory('알수없는열,업체명,품목,정상수량,파손수량\n2026.10.16,한고연스스,모래,2,1', '2026-10'));
});
function fetcher(overrides={}) {
  return async url => {
    const which=url.includes('2PACX')?'archive':url.includes('1Ju4')?'crm':url.includes('1Ml8')?'photos':'factory';
    if(overrides[which] instanceof Error)throw overrides[which];
    return new Response(overrides[which]??{archive,crm,factory,photos}[which]);
  };
}
test('live pipeline retains archive, adds CRM and never adds factory rows to claims',async()=>{
  const data=await loadDashboard(fetcher());
  assert.equal(data.rows.length,2); assert.equal(data.factory.records,1); assert.deepEqual(data.warnings,[]);
  assert.equal(parseArchive(archive)[0].date,'2026-08-03');
});
test('CRM failure fails closed rather than serving stale September data',async()=>{
  await assert.rejects(()=>loadDashboard(fetcher({crm:new Error('timeout')})));
  await assert.rejects(()=>loadDashboard(fetcher({crm:'<!doctype html>sign in'})));
});
test('factory failure leaves CRM available with an explicit warning',async()=>{
  const data=await loadDashboard(fetcher({factory:new Error('timeout')}));
  assert.equal(data.rows.length,2); assert.equal(data.factory,null); assert.equal(data.warnings.length,1);
});

const photo='https://drive.google.com/file/d/photo_123/view';
function formRows(product='아메리칸솔루션 고양이모래 옵티멈, 6kg, 2개',order='2026091612345678',date='2026-09-16') {
  return parsePhotoForms(csv([photoHeaders,[date,'한고연스스',order,'김철수',product,'카사바','1',photo,photo,'','서울시 010-1234-5678']]));
}
function claimRows(product='아메리칸솔루션-그랜드마스터 옵티멈 카사바 6kg*2봉',order='2026091612345678',date='2026.9.16') {
  return parseCRM(csv([crmHeaders,[date,'한고연스스','파손',order,'김철수',product]])).rows;
}
test('form photos join by full order, product line/weight and nearby date without adding cases',()=>{
  const result=attachPhotoForms(claimRows(),formRows());
  assert.equal(result.rows.length,1);assert.equal(result.rows[0].photos.length,1);
  assert.equal(result.summary.linkedSubmissions,1);assert.equal(result.unlinked.length,0);
  assert.equal(result.rows[0].cat,'카사바');
  for(const secret of ['2026091612345678','김철수','010-1234-5678','서울시'])assert.ok(!JSON.stringify(result).includes(secret));
});
test('identical masked order prefixes never merge distinct full orders',()=>{
  const result=attachPhotoForms(claimRows(),formRows(undefined,'2026091699999999'));
  assert.equal(result.rows[0].photos.length,0);assert.equal(result.unlinked.length,1);
});
test('different product, weight, old date or ambiguous incidents remain visible but unlinked',()=>{
  for(const forms of [formRows('아메리칸솔루션 그랜드마스터 12.6kg'),formRows('아메리칸솔루션 옵티멈 4kg'),formRows(undefined,undefined,'2026-09-10')]){
    const result=attachPhotoForms(claimRows(),forms);
    assert.equal(result.rows[0].photos.length,0);assert.equal(result.unlinked.length,1);
  }
  const result=attachPhotoForms([...claimRows(),...claimRows()],formRows());
  assert.equal(result.unlinked.length,1);assert.equal(result.summary.photos,1);
});
test('one-day reporting delay is allowed; same order a week later is not reused',()=>{
  const result=attachPhotoForms([...claimRows(undefined,undefined,'2026.9.15'),...claimRows(undefined,undefined,'2026.9.9')],formRows());
  assert.equal(result.rows[0].photos.length,1);assert.equal(result.rows[1].photos.length,0);
});
test('photo-source failure is an explicit unavailable state rather than zero photos',async()=>{
  const data=await loadDashboard(fetcher({photos:new Error('unavailable')}));
  assert.equal(data.rows.length,2);assert.equal(data.photoSummary.status,'unavailable');assert.equal(data.warnings.length,1);
});
