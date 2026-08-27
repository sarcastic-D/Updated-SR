// Date helpers (week starts on Monday)

export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fromISODate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function startOfWeekMonday(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // Sun=0..Sat=6
  const diff = (day + 6) % 7; // Mon=0
  d.setDate(d.getDate() - diff);
  return d;
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function weekDays(monday) {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

const DAY_NAMES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function dayLabel(d) { return DAY_NAMES[(d.getDay() + 6) % 7]; }
export function monthLabel(d) { return MONTHS[d.getMonth()]; }

export function formatRange(monday) {
  const sun = addDays(monday, 6);
  const a = `${monday.getDate()} ${monthLabel(monday)}`;
  const b = `${sun.getDate()} ${monthLabel(sun)} ${sun.getFullYear()}`;
  return `${a} — ${b}`;
}

export function isWeekend(d) {
  const day = d.getDay();
  return day === 0 || day === 6;
}
