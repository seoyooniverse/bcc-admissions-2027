import { createHmac, timingSafeEqual } from 'node:crypto';
import { databaseConfig, databaseRequest } from './_shared.js';

const COOKIE = 'bcc_admin';
const MAX_AGE = 8 * 60 * 60;
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const reply = (data, status = 200, cookie) => new Response(JSON.stringify(data), {
  status, headers: { ...headers, ...(cookie ? { 'Set-Cookie': cookie } : {}) },
});
const secret = () => `${process.env.SUPABASE_SECRET_KEY || ''}:${process.env.ADMIN_ACCESS_PASSWORD || ''}`;
const sign = value => createHmac('sha256', secret()).update(value).digest('hex');
const same = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
};
const configured = () => Boolean(databaseConfig() && process.env.ADMIN_ACCESS_PASSWORD?.length >= 7);
const cookieValue = request => request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
const authorized = request => {
  if (!configured()) return false;
  const [expires, signature] = (cookieValue(request) || '').split('.');
  return /^\d+$/.test(expires || '') && Number(expires) > Date.now() && same(signature, sign(expires));
};

export async function POST(request) {
  if (!configured()) return reply({ error: '관리자 페이지 설정이 필요합니다.' }, 503);
  try {
    const clientIp = request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || 'unknown';
    const ipHash = sign(`admin-login:${clientIp}`);
    const windowStart = new Date(Math.floor(Date.now() / 3600000) * 3600000).toISOString();
    const path = `consultation_rate_limits?ip_hash=eq.${ipHash}&window_start=eq.${encodeURIComponent(windowStart)}&select=request_count`;
    const current = await databaseRequest(path);
    if (!current.response.ok || !Array.isArray(current.body)) throw new Error('Rate lookup failed');
    const attempts = Number(current.body[0]?.request_count || 0);
    if (attempts >= 5) return reply({ error: '로그인 시도 횟수를 초과했습니다. 한 시간 뒤 다시 시도해 주세요.' }, 429);
    const recorded = await databaseRequest('consultation_rate_limits?on_conflict=ip_hash,window_start', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ ip_hash: ipHash, window_start: windowStart, request_count: attempts + 1 }),
    });
    if (!recorded.response.ok) throw new Error('Rate update failed');
  } catch {
    return reply({ error: '로그인을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 503);
  }
  let input;
  try { input = await request.json(); } catch { return reply({ error: '비밀번호를 입력해 주세요.' }, 400); }
  if (!same(input?.password, process.env.ADMIN_ACCESS_PASSWORD)) return reply({ error: '비밀번호를 확인해 주세요.' }, 401);
  const expires = String(Date.now() + MAX_AGE * 1000);
  return reply({ ok: true }, 200, `${COOKIE}=${expires}.${sign(expires)}; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=${MAX_AGE}`);
}

export async function GET(request) {
  if (!authorized(request)) return reply({ error: '로그인이 필요합니다.' }, 401);
  try {
    const path = 'consultation_requests?select=id,created_at,kind,status,major,applicant_name,phone,applicant_role,question,consultation_date,consultation_time,consultation_method,callback_time,callback_method,source,sms_status&order=created_at.desc&limit=200';
    const { response, body } = await databaseRequest(path);
    if (!response.ok || !Array.isArray(body)) throw new Error('Read failed');
    return reply({ requests: body });
  } catch {
    return reply({ error: '신청 내역을 불러오지 못했습니다.' }, 503);
  }
}

export async function DELETE() {
  return reply({ ok: true }, 200, `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=0`);
}
