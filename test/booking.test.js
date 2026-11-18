import test from 'node:test';
import assert from 'node:assert/strict';
import { availableTimes, validateApplication } from '../api/_shared.js';
import { GET } from '../api/slots.js';
import { POST } from '../api/consultations.js';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

test('only declared 30-minute slots are accepted', () => {
  assert.deepEqual(availableTimes('2026-11-17').slice(0, 2), ['10:00–10:30', '10:30–11:00']);
  assert.equal(availableTimes('2026-11-20').length, 0);
  assert.equal(availableTimes('2026-11-31').length, 0);
  const application = {
    kind: 'booking', major: 'media', name: '홍길동', phone: '010-1234-5678',
    role: 'student', consent: true, date: '2026-12-01', time: '10:00–10:30', method: '교내 대면',
  };
  assert.equal(validateApplication(application)?.phone, '01012345678');
  assert.equal(validateApplication({ ...application, time: '12:00–12:30' }), null);
  assert.equal(validateApplication({ ...application, consent: false }), null);
});

test('duplicate booking returns conflict and sends no SMS', async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ code: '23505' }), { status: 409 });
  };
  const request = new Request('https://example.test/api/consultations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'booking', major: 'media', name: '홍길동', phone: '01012345678',
      role: 'student', consent: true, date: '2026-12-01', time: '10:00–10:30', method: '교내 대면',
    }),
  });
  const response = await POST(request);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'SLOT_TAKEN');
  assert.equal(calls, 1);
});

test('slot endpoint reveals booked times without personal data', async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
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
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
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
      role: 'parent', consent: true, date: '2026-12-01', time: '10:00–10:30', method: '교내 대면',
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
