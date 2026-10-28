import { test } from 'node:test';
import assert from 'node:assert/strict';
import { koreanMonth, monthFromTitle, parseSheetCatalog, monthsThrough } from '../lib/month-sources.js';

test('Korean midnight changes the month and the year independently of server timezone',()=>{
  assert.equal(koreanMonth(new Date('2026-12-31T14:59:59Z')),'2026-12');
  assert.equal(koreanMonth(new Date('2026-12-31T15:00:00Z')),'2027-01');
  assert.equal(koreanMonth(new Date('2027-01-31T15:00:00Z')),'2027-02');
  assert.deepEqual(monthsThrough('2027-02').slice(-3),['2026-12','2027-01','2027-02']);
});
test('only exact month names match; copies, wrong years and impossible months do not',()=>{
  for(const title of ['2027 1월','2027년 1월','2027-01'])assert.equal(monthFromTitle(title,'crm'),'2027-01');
  assert.equal(monthFromTitle('2701 ','factory'),'2027-01');
  for(const title of ['2027 1월의 사본','2027 1월 백업','2027 13월','1월','2701'])assert.equal(monthFromTitle(title,'crm'),'');
  assert.equal(monthFromTitle('2713','factory'),'');
});
test('tab metadata is parsed without executing source JavaScript; schema changes fail visibly',()=>{
  const html='items.push({name: "2027 1월", pageUrl: "unused", gid: "123", initialSheet: false}); throw Error("do not execute");';
  assert.equal(parseSheetCatalog(html,'crm')['2027-01'][0].gid,'123');
  assert.throws(()=>parseSheetCatalog('<html>login</html>','crm'));
});
