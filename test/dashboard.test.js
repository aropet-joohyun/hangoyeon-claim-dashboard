import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1].replace(/\nload\(\);\n/, '\n');
const row = (month, type) => ({date:month+'-02',type,product:'모래',cat:'미분류',photos:[],memo:'',src:'CRM반품'});
function fixture(month, status='ready') {
  return {rows:[row('2026-09','고객 클레임'),row('2026-09','파손반송'),row('2026-09','파손반송'),
    ...(status==='ready'?[row(month,'고객 클레임'),row(month,'파손반송')]:[])],
    liveMonth:month,liveMonths:['2026-09',month],monthStatuses:{[month]:{crm:status}},
    warnings:[],crmLatestDate:month+'-02',fetchedAt:month+'-02T00:00:00Z',unlinkedPhotos:[]};
}
function browser(data, time) {
  const elements={}; const events={}; const intervals=[];
  const context=vm.createContext({Intl,console,currentTime:time,mockData:data,
    document:{hidden:false,getElementById:id=>elements[id]||=( {style:{},innerHTML:'',textContent:''} ),
      querySelectorAll:()=>[],addEventListener:(name,callback)=>events[name]=callback},
    window:{scrollTo:()=>{}},setInterval:(callback,ms)=>intervals.push({callback,ms}),
    fetch:async()=>({ok:true,json:async()=>context.mockData})});
  vm.runInContext('Date=class extends Date {constructor(...args){super(...(args.length?args:[currentTime]));} static now(){return new Date(currentTime).getTime();}}',context);
  vm.runInContext(script,context);
  return {context,elements,events,intervals};
}
test('combined chart sums the two case types, preserves original chart and short month tabs',async()=>{
  const {context,elements}=browser(fixture('2026-10'),'2026-10-28T00:00:00Z');
  await vm.runInContext('load()',context);
  assert.match(elements.view.innerHTML,/月|월별 파손 발생 비교/);
  assert.match(elements.view.innerHTML,/id="combined-chart"/);
  assert.match(elements.view.innerHTML,/data-month="2026-09" data-total="3"/);
  assert.match(elements.view.innerHTML,/data-month="2026-10" data-total="2"/);
  assert.ok(!elements.nav.innerHTML.includes('상세'));
});
test('Korean New Year switches an open page to January with year-qualified labels and pending state',async()=>{
  const {context,elements,intervals}=browser(fixture('2026-12'),'2026-12-31T14:59:59Z');
  await vm.runInContext('load()',context);
  context.currentTime='2026-12-31T15:00:00Z';context.mockData=fixture('2027-01','pending');
  await vm.runInContext('autoRefresh()',context);
  assert.match(elements.nav.innerHTML,/2027년 1월/);
  assert.match(elements.nav.innerHTML,/2026년 9월/);
  assert.match(elements.view.innerHTML,/시트 준비 중/);
  assert.ok(!elements.view.innerHTML.includes('0건'));
  assert.equal(vm.runInContext('activeView',context),'2027-01');
  vm.runInContext('show("dash")',context);
  assert.match(elements.view.innerHTML,/data-month="2027-01" data-total=""/);
  assert.equal(intervals[0].ms,60000);
});
test('after five minutes the page refreshes and retains its selected historical month',async()=>{
  const {context}=browser(fixture('2026-10'),'2026-10-28T00:00:00Z');
  await vm.runInContext('load()',context);
  vm.runInContext('show("2026-09")',context);
  context.currentTime='2026-10-28T00:05:01Z';
  await vm.runInContext('autoRefresh()',context);
  assert.equal(vm.runInContext('activeView',context),'2026-09');
  assert.equal(vm.runInContext('lastLoaded',context),new Date(context.currentTime).getTime());
});
