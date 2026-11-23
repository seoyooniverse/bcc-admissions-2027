import { createHmac, timingSafeEqual } from 'node:crypto';
import { databaseConfig, databaseRequest, json } from './_shared.js';

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
const configured = () => Boolean(databaseConfig() && process.env.ADMIN_ACCESS_PASSWORD?.length >= 16);
const cookieValue = request => request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
const authorized = request => {
  if (!configured()) return false;
  const [expires, signature] = (cookieValue(request) || '').split('.');
  return /^\d+$/.test(expires || '') && Number(expires) > Date.now() && same(signature, sign(expires));
};

export async function POST(request) {
  if (!configured()) return reply({ error: '관리자 페이지 설정이 필요합니다.' }, 503);
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
