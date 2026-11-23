import { createHmac, randomBytes } from 'node:crypto';

export const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
export const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });

export function databaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

export async function databaseRequest(path, options = {}) {
  const config = databaseConfig();
  if (!config) throw new Error('Database is not configured');
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

export const phoneDigits = value => String(value || '').replace(/\D/g, '');
export const validPhone = value => /^01[016789]\d{7,8}$/.test(value);
const pad = n => String(n).padStart(2, '0');

export function availableTimes(date) {
  if (!/^2026-(11|12)-\d{2}$/.test(date)) return [];
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return [];
  const weekday = parsed.getUTCDay();
  const ranges = { 2: [[600, 720], [960, 1170]], 3: [[960, 1170]], 4: [[600, 1170]] }[weekday] || [];
  const result = [];
  for (const [start, end] of ranges) {
    for (let minute = start; minute + 30 <= end; minute += 30) {
      result.push(`${pad(Math.floor(minute / 60))}:${pad(minute % 60)}–${pad(Math.floor((minute + 30) / 60))}:${pad((minute + 30) % 60)}`);
    }
  }
  return result;
}

export function isFutureSlot(date, time) {
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
  return `${date}T${time.slice(0, 5)}` > nowKst;
}

export function validateApplication(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const kind = input.kind;
  const major = input.major;
  const applicant_name = String(input.name || '').trim();
  const phone = phoneDigits(input.phone);
  const applicant_role = input.role;
  const question = String(input.question || '').trim();
  const source = String(input.source || 'direct').trim().slice(0, 100);
  if (!['booking', 'callback'].includes(kind) || !['media', 'webtoon'].includes(major)
      || !applicant_name || applicant_name.length > 40 || !validPhone(phone)
      || !['student', 'parent'].includes(applicant_role) || question.length > 500
      || input.consent !== true) return null;
  const base = { kind, major, applicant_name, phone, applicant_role, question, source };
  if (kind === 'booking') {
    const consultation_date = String(input.date || '');
    const consultation_time = String(input.time || '');
    const consultation_method = String(input.method || '');
    if (!availableTimes(consultation_date).includes(consultation_time)
        || !isFutureSlot(consultation_date, consultation_time)
        || !['학교 방문 대면', '교내 대면', '전화'].includes(consultation_method)) return null;
    return { ...base, consultation_date, consultation_time, consultation_method };
  }
  const callback_time = String(input.callbackTime || '');
  const callback_method = String(input.callbackMethod || '');
  if (!['오후', '저녁', '별도 협의'].includes(callback_time)
      || !['학교 방문 대면', '교내 대면', '전화', '실시간 온라인 희망', '주말 상담 희망'].includes(callback_method)) return null;
  return { ...base, callback_time, callback_method };
}

export async function sendSolapi(messages) {
  const { SOLAPI_API_KEY: key, SOLAPI_API_SECRET: secret, SOLAPI_SENDER_NUMBER: sender } = process.env;
  if (!key || !secret || !sender) return { status: 'skipped' };
  const date = new Date().toISOString();
  const salt = randomBytes(16).toString('hex');
  const signature = createHmac('sha256', secret).update(date + salt).digest('hex');
  const response = await fetch('https://api.solapi.com/messages/v4/send-many/detail', {
    method: 'POST',
    headers: {
      Authorization: `HMAC-SHA256 apiKey=${key}, date=${date}, salt=${salt}, signature=${signature}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages: messages.map(message => ({ ...message, from: phoneDigits(sender), autoTypeDetect: true })) }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.failedMessageList?.length || body?.groupInfo?.count?.registeredFailed) {
    throw new Error('Solapi did not accept all messages');
  }
  return { status: 'sent', groupId: body?.groupInfo?.groupId || null };
}
