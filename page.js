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
  for (const time of consultationSlots(selectedDate)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = time;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
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
    button.disabled = !consultationHours[weekday] || date < '2026-11-17';
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

document.getElementById('previous-month').addEventListener('click', () => { month = 10; renderCalendar(); });
document.getElementById('next-month').addEventListener('click', () => { month = 11; renderCalendar(); });
for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', () => {
    mode = button.dataset.mode;
    for (const sibling of document.querySelectorAll('[data-mode]')) sibling.setAttribute('aria-pressed', String(sibling === button));
    document.getElementById('booking-fields').hidden = mode !== 'booking';
    document.getElementById('callback-fields').hidden = mode !== 'callback';
    updateSummary();
  });
}
form.addEventListener('submit', event => {
  event.preventDefault();
  const status = document.getElementById('form-status');
  if (mode === 'booking' && (!selectedDate || !selectedTime)) {
    status.textContent = '상담 날짜와 시간을 모두 선택해 주세요.';
    return;
  }
  const data = new FormData(form);
  status.textContent = data.get('name') + '님의 ' + (mode === 'booking' ? selectedDate + ' ' + selectedTime + ' 상담 예약' : '상담 연락 요청') + ' 미리보기입니다. 실제 신청은 접수되지 않았습니다.';
});
renderCalendar();

document.getElementById('request-contact').addEventListener('click', () => {
  document.querySelector('[data-mode="callback"]').click();
  const target = document.querySelector('#callback-fields select');
  target.focus();
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
});
