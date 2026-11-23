const loginPanel = document.querySelector('#login-panel');
const dashboard = document.querySelector('#dashboard');
const loginMessage = document.querySelector('#login-message');
const listMessage = document.querySelector('#list-message');
const list = document.querySelector('#requests');
const filter = document.querySelector('#filter');
let rows = [];
const text = value => String(value ?? '');
const add = (parent, tag, value, className) => { const node = document.createElement(tag); node.textContent = text(value); if (className) node.className = className; parent.append(node); return node; };
const field = (dl, label, value) => { add(dl, 'dt', label); add(dl, 'dd', value || '—'); };
const dateTime = value => value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '—';

function render() {
  const shown = rows.filter(row => filter.value === 'all' || row.kind === filter.value);
  document.querySelector('#count').textContent = `${shown.length}건`;
  list.replaceChildren();
  if (!shown.length) { add(list, 'p', '표시할 신청 내역이 없습니다.'); return; }
  for (const row of shown) {
    const article = add(list, 'article', '', 'request');
    const head = add(article, 'div', '', 'request-head');
    add(head, 'h2', `${row.applicant_name} · ${row.major === 'media' ? '미디어앤아트테크놀로지학과' : '웹툰콘텐츠학과'}`);
    add(head, 'span', dateTime(row.created_at), 'request-meta');
    const chips = add(article, 'div', '', 'chips');
    add(chips, 'span', row.kind === 'booking' ? '예약 상담' : '일정 조율 요청', 'chip');
    add(chips, 'span', row.status === 'cancelled' ? '취소' : '접수', 'chip');
    add(chips, 'span', `문자 ${row.sms_status}`, 'chip');
    const dl = add(article, 'dl', '');
    field(dl, '연락처', row.phone);
    field(dl, '신청자', row.applicant_role === 'parent' ? '학부모' : '학생');
    field(dl, '상담 일정', row.kind === 'booking' ? `${row.consultation_date} ${row.consultation_time}` : `일정 조율 · ${row.callback_time || '별도 협의'}`);
    field(dl, '상담 방식', row.kind === 'booking' ? row.consultation_method : row.callback_method);
    field(dl, '유입 경로', row.source);
    const question = add(article, 'dl', '', 'question');
    field(question, '문의 내용', row.question || '입력한 내용 없음');
    if (row.kind === 'booking' && row.status === 'confirmed') {
      const cancel = add(article, 'button', '예약 취소', 'cancel-button');
      cancel.type = 'button';
      cancel.addEventListener('click', () => cancelBooking(row, cancel));
    }
  }
}

async function cancelBooking(row, button) {
  if (!window.confirm(`${row.applicant_name}님의 ${row.consultation_date} ${row.consultation_time} 예약을 취소할까요?\n취소하면 이 시간이 다시 예약 가능해집니다. 신청자에게는 직접 안내해 주세요.`)) return;
  button.disabled = true;
  listMessage.textContent = '';
  const response = await fetch('/api/admin', {
    method: 'PATCH', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: row.id }),
  }).catch(() => null);
  const body = await response?.json().catch(() => ({}));
  if (!response?.ok) {
    listMessage.textContent = body?.error || '예약을 취소하지 못했습니다.';
    button.disabled = false;
    return;
  }
  await load();
  listMessage.textContent = '예약을 취소했습니다. 신청자에게 직접 안내해 주세요.';
}

async function load() {
  listMessage.textContent = '';
  const response = await fetch('/api/admin', { credentials: 'same-origin', cache: 'no-store' }).catch(() => null);
  if (!response || response.status === 401) { dashboard.hidden = true; loginPanel.hidden = false; return; }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { listMessage.textContent = body.error || '신청 내역을 불러오지 못했습니다.'; return; }
  rows = body.requests;
  loginPanel.hidden = true;
  dashboard.hidden = false;
  document.querySelector('#logout').hidden = false;
  render();
}

document.querySelector('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  loginMessage.textContent = '';
  const password = document.querySelector('#password');
  const response = await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password.value }) }).catch(() => null);
  password.value = '';
  const body = await response?.json().catch(() => ({}));
  if (!response?.ok) { loginMessage.textContent = body?.error || '로그인할 수 없습니다.'; return; }
  await load();
});
document.querySelector('#refresh').addEventListener('click', load);
filter.addEventListener('change', render);
document.querySelector('#logout').addEventListener('click', async () => { await fetch('/api/admin', { method: 'DELETE' }); rows = []; dashboard.hidden = true; loginPanel.hidden = false; document.querySelector('#logout').hidden = true; });
load();
