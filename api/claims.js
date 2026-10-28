import { loadAllMonths } from '../lib/claim-data.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GET 요청만 지원합니다.' });
  }
  try { return res.status(200).json(await loadAllMonths()); }
  catch { return res.status(502).json({ error: '시트 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }); }
}
