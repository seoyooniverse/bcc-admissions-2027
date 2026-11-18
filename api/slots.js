import { databaseRequest, json } from './_shared.js';

export async function GET(request) {
  const month = new URL(request.url).searchParams.get('month');
  if (!/^2026-(11|12)$/.test(month || '')) return json({ error: '잘못된 조회 기간입니다.' }, 400);
  try {
    const query = new URLSearchParams({
      select: 'consultation_date,consultation_time',
      kind: 'eq.booking',
      status: 'eq.confirmed',
      consultation_date: `gte.${month}-01`,
    });
    query.append('consultation_date', `lt.${month === '2026-11' ? '2026-12-01' : '2027-01-01'}`);
    const { response, body } = await databaseRequest(`consultation_requests?${query}`);
    if (!response.ok) throw new Error('Database read failed');
    return json({ booked: body.map(row => `${row.consultation_date}|${row.consultation_time}`) });
  } catch {
    return json({ error: '예약 현황을 불러오지 못했습니다.' }, 503);
  }
}
