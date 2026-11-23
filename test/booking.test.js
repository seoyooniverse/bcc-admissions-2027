import test from 'node:test';
import assert from 'node:assert/strict';
import { availableTimes, validateApplication } from '../api/_shared.js';
import { GET } from '../api/slots.js';
import { POST, applicantMessage } from '../api/consultations.js';
import { POST as adminLogin, GET as adminList } from '../api/admin.js';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

test('only declared 30-minute slots are accepted', () => {
  assert.deepEqual(availableTimes('2026-12-01').slice(0, 2), ['10:00–10:30', '10:30–11:00']);
  assert.equal(availableTimes('2026-12-04').length, 0);
  assert.equal(availableTimes('2026-12-32').length, 0);
  assert.equal(availableTimes('2026-11-24').length, 0);
  const application = {
    kind: 'booking', major: 'media', name: '홍길동', phone: '010-1234-5678',
    role: 'student', consent: true, date: '2026-12-01', time: '10:00–10:30', method: '명지대학교 방문 상담(권장)',
  };
  assert.equal(validateApplication(application)?.phone, '01012345678');
  assert.equal(validateApplication({ ...application, time: '12:00–12:30' }), null);
  assert.equal(validateApplication({ ...application, consent: false }), null);
});

test('applicant SMS distinguishes a confirmed visit from a callback request', () => {
  const booking = applicantMessage({
    kind: 'booking', major: 'media', applicant_name: '홍길동',
    consultation_date: '2026-12-01', consultation_time: '10:00–10:30',
    consultation_method: '명지대학교 방문 상담(권장)',
  });
  assert.match(booking, /12월 1일\(화\) 10:00~10:30/);
  assert.match(booking, /명지대학교 인문캠퍼스/);
  assert.match(booking, /해당 번호로 연락해 주세요/);
  const callback = applicantMessage({
    kind: 'callback', major: 'webtoon', applicant_name: '홍길동',
    callback_time: '저녁', callback_method: '온라인 혹은 유선 상담',
  });
  assert.match(callback, /연락 요청이 접수되었습니다/);
  assert.doesNotMatch(callback, /예약이 완료되었습니다/);
});

test('duplicate booking returns conflict and sends no SMS', async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'test-key';
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ code: '23505' }), { status: 409 });
  };
  const request = new Request('https://example.test/api/consultations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'booking', major: 'media', name: '홍길동', phone: '01012345678',
      role: 'student', consent: true, date: '2026-12-01', time: '10:00–10:30', method: '명지대학교 방문 상담(권장)',
    }),
  });
  const response = await POST(request);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'SLOT_TAKEN');
  assert.equal(calls, 1);
});

test('slot endpoint reveals booked times without personal data', async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'test-key';
  globalThis.fetch = async () => new Response(JSON.stringify([
    { consultation_date: '2026-12-01', consultation_time: '10:00–10:30', applicant_name: '비공개' },
  ]));
  const response = await GET(new Request('https://example.test/api/slots?month=2026-12'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.booked, ['2026-12-01|10:00–10:30']);
  assert.equal(JSON.stringify(body).includes('비공개'), false);
});

test('successful booking is stored before notification status is updated', async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'test-key';
  delete process.env.SOLAPI_API_KEY;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), method: options.method, body: options.body && JSON.parse(options.body) });
    return options.method === 'POST'
      ? new Response(JSON.stringify('application-1'), { status: 200 })
      : new Response(null, { status: 204 });
  };
  const request = new Request('https://example.test/api/consultations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'booking', major: 'webtoon', name: '홍길동', phone: '01012345678',
      role: 'parent', consent: true, date: '2026-12-01', time: '10:00–10:30', method: '명지대학교 방문 상담(권장)',
    }),
  });
  const response = await POST(request);
  assert.equal(response.status, 201);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body.p_application.consultation_time, '10:00–10:30');
  assert.equal(calls[0].body.p_ip_hash.length, 64);
  assert.equal(calls[1].method, 'PATCH');
  assert.equal(calls[1].body.sms_status, 'skipped');
});

test('admin requests require a signed login cookie', async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'test-secret';
  process.env.ADMIN_ACCESS_PASSWORD = '1234567';
  let databaseReads = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('consultation_rate_limits')) {
      return new Response(options.method === 'POST' ? null : JSON.stringify([]), { status: options.method === 'POST' ? 204 : 200 });
    }
    databaseReads++;
    return new Response(JSON.stringify([{ id: 'request-1', question: '포트폴리오 문의' }]));
  };
  const url = 'https://example.test/api/admin';
  assert.equal((await adminList(new Request(url))).status, 401);
  assert.equal(databaseReads, 0);
  const wrong = await adminLogin(new Request(url, { method: 'POST', body: JSON.stringify({ password: 'wrong' }) }));
  assert.equal(wrong.status, 401);
  const login = await adminLogin(new Request(url, { method: 'POST', body: JSON.stringify({ password: process.env.ADMIN_ACCESS_PASSWORD }) }));
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const list = await adminList(new Request(url, { headers: { cookie } }));
  assert.equal(list.status, 200);
  assert.equal((await list.json()).requests[0].question, '포트폴리오 문의');
  assert.equal(databaseReads, 1);
});

test('admin login stops after five attempts from the same address', async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'test-secret';
  process.env.ADMIN_ACCESS_PASSWORD = '1234567';
  let attempts = 5;
  globalThis.fetch = async (url, options) => {
    if (options.method === 'POST') attempts++;
    return new Response(JSON.stringify([{ request_count: attempts }]));
  };
  const response = await adminLogin(new Request('https://example.test/api/admin', {
    method: 'POST', body: JSON.stringify({ password: '1234567' }),
  }));
  assert.equal(response.status, 429);
  assert.equal(attempts, 5);
});
