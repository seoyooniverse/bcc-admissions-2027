import { createHmac } from 'node:crypto';
import { databaseConfig, databaseRequest, json, phoneDigits, sendSolapi, validateApplication } from './_shared.js';

export function applicantMessage(application) {
  const major = application.major === 'media' ? '미디어앤아트테크놀로지학과' : '웹툰콘텐츠학과';
  if (application.kind === 'callback') {
    return `[명지대학교 미래융합대학]\n${application.applicant_name}님, 진학 상담 연락 요청이 접수되었습니다.\n\n신청 학과: ${major}\n희망 시간: ${application.callback_time}\n희망 방식: ${application.callback_method}\n\n담당자가 일정 조율을 위해 연락드리겠습니다. 문의사항은 해당 번호로 연락해 주세요. 감사합니다.`;
  }
  const [year, month, day] = application.consultation_date.split('-').map(Number);
  const weekday = '일월화수목금토'[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const time = application.consultation_time.replace('–', '~');
  const visit = ['명지대학교 방문 상담(권장)', '학교 방문 대면', '교내 대면'].includes(application.consultation_method);
  const method = visit ? '명지대학교 방문 상담' : application.consultation_method;
  const place = visit ? '\n장소: 명지대학교 인문캠퍼스(서울 서대문구 거북골로 34)' : '';
  return `[명지대학교 미래융합대학]\n${application.applicant_name}님, 진학 상담 예약이 완료되었습니다.\n\n상담 방식: ${method}\n신청 학과: ${major}\n일시: ${year}년 ${month}월 ${day}일(${weekday}) ${time}${place}\n\n일정 변경 및 문의사항은 해당 번호로 연락해 주세요. 감사합니다.`;
}

export async function POST(request) {
  if (!databaseConfig()) return json({ error: '예약 접수 준비 중입니다.' }, 503);
  if (Number(request.headers.get('content-length') || 0) > 12000) return json({ error: '입력 내용이 너무 깁니다.' }, 413);
  let input;
  try { input = await request.json(); } catch { return json({ error: '신청 내용을 확인해 주세요.' }, 400); }
  if (input?.website) return json({ error: '신청 내용을 확인해 주세요.' }, 400);
  const application = validateApplication(input);
  if (!application) return json({ error: '필수 정보와 개인정보 동의를 확인해 주세요.' }, 400);

  let id;
  try {
    const clientIp = request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || 'unknown';
    const ipHash = createHmac('sha256', process.env.SUPABASE_SECRET_KEY).update(clientIp).digest('hex');
    const { response, body } = await databaseRequest('rpc/submit_consultation', {
      method: 'POST',
      body: JSON.stringify({ p_application: application, p_ip_hash: ipHash }),
    });
    if (response.status === 409 || body?.code === '23505') return json({ error: '방금 예약된 시간입니다. 다른 시간을 선택해 주세요.', code: 'SLOT_TAKEN' }, 409);
    if (body?.message === 'rate_limited') return json({ error: '신청 횟수가 많습니다. 잠시 후 다시 시도해 주세요.' }, 429);
    if (!response.ok || typeof body !== 'string') throw new Error('Database write failed');
    id = body;
  } catch {
    return json({ error: '접수 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' }, 503);
  }

  const majorName = application.major === 'media' ? '미디어앤아트테크놀로지' : '웹툰콘텐츠';
  const detail = application.kind === 'booking'
    ? `${application.consultation_date} ${application.consultation_time} ${application.consultation_method}`
    : `일정 조율 요청 (${application.callback_time}, ${application.callback_method})`;
  const manager = phoneDigits(process.env.CONSULTATION_MANAGER_NUMBER);
  const messages = [{ to: application.phone, text: applicantMessage(application) }];
  if (manager) {
    messages.push({ to: manager, text: `[BCC 상담 신청] ${application.applicant_name} / ${application.phone} / ${majorName} / ${detail} / 유입 ${application.source}` });
  }
  let sms = { status: 'skipped' };
  try { sms = await sendSolapi(messages); }
  catch { sms = { status: 'failed' }; }
  try {
    await databaseRequest(`consultation_requests?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ sms_status: sms.status, sms_group_id: sms.groupId || null }),
    });
  } catch { /* Booking remains confirmed; staff can inspect pending SMS in database. */ }
  return json({ id, kind: application.kind, smsStatus: sms.status }, 201);
}
