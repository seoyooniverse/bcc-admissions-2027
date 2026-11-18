const major = new URLSearchParams(window.location.search).get('major');

if (major === 'media' || major === 'webtoon') {
  const majorCard = document.getElementById(major);
  majorCard.parentElement.prepend(majorCard);
  majorCard.querySelector('details').open = true;
  for (const select of document.querySelectorAll('[data-major]')) {
    select.value = major;
  }
}

let month = 10;
let selectedDate = '';
let selectedTime = '';
let mode = 'booking';
const form = document.getElementById('consult-form');
const summary = document.getElementById('selection-summary');
const times = document.getElementById('times');
const params = new URLSearchParams(location.search);
const source = params.get('utm_source') || 'direct';
const bookedSlots = new Set();
const notice = document.getElementById('booking-notice');
const submitButton = document.getElementById('submit-button');
let bookingReady = false;

async function loadSlots() {
  bookingReady = false;
  submitButton.disabled = true;
  notice.textContent = '예약 현황을 확인하고 있습니다.';
  const requestedMonth = month;
  try {
    const response = await fetch('/api/slots?month=2026-' + String(month + 1).padStart(2, '0'), { cache: 'no-store' });
    if (!response.ok) throw new Error('slot fetch failed');
    const data = await response.json();
    if (requestedMonth !== month) return;
    bookedSlots.clear();
    for (const slot of data.booked || []) bookedSlots.add(slot);
    bookingReady = true;
    notice.textContent = '회색으로 표시된 시간은 예약이 완료되어 선택할 수 없습니다.';
    submitButton.disabled = false;
    renderTimes();
  } catch {
    if (requestedMonth !== month) return;
    notice.textContent = '예약 현황을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
    renderTimes();
  }
}

function updateSummary() {
  summary.textContent = mode === 'callback'
    ? '담당자가 연락해 상담 일정을 조율합니다.'
    : selectedDate && selectedTime
      ? selectedDate + ' · ' + selectedTime + ' · 30분'
      : '날짜와 시간을 선택하면 여기에서 확인할 수 있습니다.';
  document.getElementById('form-status').textContent = '';
}

// Thursday opening and evening closing are provisional until confirmed.
const consultationHours = {
  2: [[600, 720], [960, 1170]],
  3: [[960, 1170]],
  4: [[600, 1170]],
};

function consultationSlots(date) {
  const [year, monthNumber, day] = date.split('-').map(Number);
  const weekday = new Date(year, monthNumber - 1, day).getDay();
  const format = minutes => String(Math.floor(minutes / 60)).padStart(2, '0')
    + ':' + String(minutes % 60).padStart(2, '0');
  const slots = [];
  for (const [start, end] of consultationHours[weekday] || []) {
    for (let minute = start; minute + 30 <= end; minute += 30) {
      slots.push(format(minute) + '–' + format(minute + 30));
    }
  }
  return slots;
}

function renderTimes() {
  times.replaceChildren();
  if (!selectedDate) return;
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
  for (const time of consultationSlots(selectedDate)) {
    const button = document.createElement('button');
    button.type = 'button';
    const booked = bookedSlots.has(selectedDate + '|' + time);
    const passed = selectedDate + 'T' + time.slice(0, 5) <= nowKst;
    button.textContent = booked ? time + ' · 예약 완료' : passed ? time + ' · 마감' : time;
    button.disabled = booked || passed || !bookingReady;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      if (booked || passed || !bookingReady) return;
      selectedTime = time;
      for (const sibling of times.children) sibling.setAttribute('aria-pressed', String(sibling === button));
      updateSummary();
    });
    times.append(button);
  }
}

function renderCalendar() {
  const calendar = document.getElementById('calendar');
  calendar.replaceChildren();
  const todayKst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  document.getElementById('month-label').textContent = '2026년 ' + (month + 1) + '월';
  document.getElementById('previous-month').disabled = month === 10;
  document.getElementById('next-month').disabled = month === 11;
  const start = new Date(2026, month, 1).getDay();
  for (let i = 0; i < start; i++) calendar.append(document.createElement('span'));
  const days = new Date(2026, month + 1, 0).getDate();
  for (let day = 1; day <= days; day++) {
    const weekday = new Date(2026, month, day).getDay();
    const date = '2026-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = day;
    button.setAttribute('aria-label', (month + 1) + '월 ' + day + '일');
    button.setAttribute('aria-pressed', String(date === selectedDate));
    button.disabled = !consultationHours[weekday] || date < todayKst;
    button.addEventListener('click', () => {
      selectedDate = date;
      selectedTime = '';
      renderCalendar();
      renderTimes();
      document.getElementById('date-status').textContent = date > '2026-12-09'
        ? '다음 모집 차수 준비 상담 · 시간을 선택해 주세요.'
        : '시간을 선택해 주세요.';
      updateSummary();
    });
    calendar.append(button);
  }
}

document.getElementById('previous-month').addEventListener('click', () => { month = 10; selectedDate = ''; selectedTime = ''; renderCalendar(); renderTimes(); loadSlots(); updateSummary(); });
document.getElementById('next-month').addEventListener('click', () => { month = 11; selectedDate = ''; selectedTime = ''; renderCalendar(); renderTimes(); loadSlots(); updateSummary(); });
for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', () => {
    mode = button.dataset.mode;
    for (const sibling of document.querySelectorAll('[data-mode]')) sibling.setAttribute('aria-pressed', String(sibling === button));
    document.getElementById('booking-fields').hidden = mode !== 'booking';
    document.getElementById('callback-fields').hidden = mode !== 'callback';
    updateSummary();
  });
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  const status = document.getElementById('form-status');
  if (!bookingReady) {
    status.textContent = '예약 시스템을 확인 중입니다. 잠시 후 다시 시도해 주세요.';
    return;
  }
  if (mode === 'booking' && (!selectedDate || !selectedTime)) {
    status.textContent = '상담 날짜와 시간을 모두 선택해 주세요.';
    return;
  }
  const data = new FormData(form);
  const payload = {
    kind: mode,
    major: data.get('major'),
    name: data.get('name'),
    phone: data.get('phone'),
    role: data.get('role') === '학부모' ? 'parent' : 'student',
    question: data.get('question'),
    date: selectedDate,
    time: selectedTime,
    method: data.get('method'),
    callbackTime: data.get('callback-time'),
    callbackMethod: data.get('callback-method'),
    source,
    website: data.get('website'),
    consent: data.get('consent') === 'on',
  };
  submitButton.disabled = true;
  status.textContent = '신청 내용을 접수하고 있습니다.';
  try {
    const response = await fetch('/api/consultations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) {
      status.textContent = result.error || '접수 중 오류가 발생했습니다.';
      if (response.status === 409) {
        selectedTime = '';
        await loadSlots();
        updateSummary();
        status.textContent = result.error;
      }
      return;
    }
    const done = mode === 'booking' ? selectedDate + ' ' + selectedTime + ' 상담' : '상담 연락 요청';
    form.reset();
    selectedDate = '';
    selectedTime = '';
    renderCalendar();
    renderTimes();
    await loadSlots();
    updateSummary();
    status.textContent = done + ' 신청이 접수됐습니다.' + (result.smsStatus === 'sent' ? ' 안내 문자를 확인해 주세요.' : ' 문자 안내는 담당자가 별도로 확인하겠습니다.');
  } catch {
    status.textContent = '접수 상태를 확인하지 못했습니다. 중복 신청 전에 담당자에게 확인해 주세요.';
  } finally {
    submitButton.disabled = !bookingReady;
  }
});
renderCalendar();
loadSlots();

document.getElementById('request-contact').addEventListener('click', () => {
  document.querySelector('[data-mode="callback"]').click();
  const target = document.querySelector('#callback-fields select');
  target.focus();
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
});
