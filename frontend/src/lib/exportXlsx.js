import XLSX from "xlsx-js-style";
import { shiftBgArgb, shiftFgColor, SOC_SHIFTS } from "@/lib/shifts";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmtIsoDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return { mm: String(m).padStart(2, "0"), dd: String(d).padStart(2, "0"), dow: DAY_NAMES[(date.getDay() + 6) % 7], isWeekend: [0, 6].includes(date.getDay()) };
}

// L3 custom shift display labels for export
const L3_SHIFT_LABELS = {
  M: "Morning (9AM–6PM)",
  A: "Noon (12PM–9PM)",
};

function buildTeamSheet({ teamLabel, employees, schedules, dates, shiftCodes }) {
  const monthLabelStr = `${teamLabel} — SOC SHIFT ROSTER`;
  const grid = [];
  const totalCols = 4 + dates.length + 3;

  // Title row
  grid.push([{ v: monthLabelStr, s: titleStyle() }, ...Array(totalCols - 1).fill({ v: "", s: titleStyle() })]);
  grid.push(Array(totalCols).fill({ v: "" }));

  const merges = [{ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } }];

  shiftCodes.forEach((shiftCode) => {
    const shiftEmps = employees.filter((e) => e.assigned_shift === shiftCode);
    if (shiftEmps.length === 0) return;

    // Shift label — L3 uses custom timing
    let shiftLabel;
    if (L3_SHIFT_LABELS[shiftCode] && teamLabel.startsWith("L3")) {
      shiftLabel = L3_SHIFT_LABELS[shiftCode].toUpperCase();
    } else {
      const SHIFT_NAMES = { M: "MORNING SHIFT (7AM–3PM)", A: "NOON SHIFT (3PM–11PM)", N: "NIGHT SHIFT (11PM–7AM)" };
      shiftLabel = SHIFT_NAMES[shiftCode] || shiftCode;
    }

    // Section banner
    const sectionRow = grid.length;
    grid.push([
      { v: shiftLabel, s: sectionStyle() },
      ...Array(totalCols - 1).fill({ v: "", s: sectionStyle() }),
    ]);
    merges.push({ s: { r: sectionRow, c: 0 }, e: { r: sectionRow, c: totalCols - 1 } });

    // Header row
    grid.push([
      { v: "ID",   s: headerStyle() },
      { v: "Name", s: headerStyle() },
      { v: "Team", s: headerStyle() },
      { v: "WO",   s: headerStyle() },
      ...dates.map((d) => {
        const { mm, dd, dow, isWeekend } = fmtIsoDate(d);
        return { v: `${mm}/${dd}\n${dow}`, s: isWeekend ? weekendHeaderStyle() : headerStyle() };
      }),
      { v: "WD",  s: headerStyle() },
      { v: "L",   s: headerStyle() },
      { v: "Adj", s: headerStyle() },
    ]);

    // Data rows
    shiftEmps.forEach((emp) => {
      const sched = schedules[emp.id];
      const wo = emp.weekoff_days || [];
      const woText = wo.length === 2 ? `${wo[0].slice(0, 3)}&${wo[1].slice(0, 3)}` : "—";
      let wd = 0, l = 0, adj = 0;

      const dayCells = dates.map((d) => {
        const status = sched?.daily_status?.[d] || "";
        if (status === "WD") wd++;
        else if (status === "L") l++;
        else if (status === "Adj") { adj++; wd++; }
        const { isWeekend } = fmtIsoDate(d);
        return { v: status, s: shiftCellStyle(status, isWeekend) };
      });

      grid.push([
        { v: emp.emp_id, s: idStyle() },
        { v: emp.name,   s: emp.is_secops ? secopsNameStyle() : nameStyle() },
        { v: emp.is_secops ? "SecOps" : "SOC", s: emp.is_secops ? secopsTeamStyle() : teamStyle() },
        { v: woText, s: rowCellStyle() },
        ...dayCells,
        { v: wd,  s: totalStyle() },
        { v: l,   s: totalStyle() },
        { v: adj, s: totalStyle() },
      ]);
    });

    grid.push(Array(totalCols).fill({ v: "" })); // spacer
  });

  const ws = XLSX.utils.aoa_to_sheet(grid);
  ws["!merges"] = merges;
  ws["!cols"] = [
    { wch: 7 }, { wch: 22 }, { wch: 10 }, { wch: 12 },
    ...dates.map(() => ({ wch: 7 })),
    { wch: 6 }, { wch: 6 }, { wch: 6 },
  ];
  ws["!rows"] = grid.map((_, i) => ({ hpt: i === 0 ? 26 : 20 }));
  ws["!freeze"] = { xSplit: 4, ySplit: 4 };
  return ws;
}

// ---------------------------------------------------------------------------
// MONTHLY ROSTER EXPORT — one workbook, separate L1 / L2 / L3 worksheets
// ---------------------------------------------------------------------------
export function exportMonthlyRosterXLSX({ year, month, dates, employees, schedules }) {
  const monthLabel = new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });

  const l1Emps = employees.filter((e) => e.soc_level === "L1");
  const l2Emps = employees.filter((e) => e.soc_level === "L2");
  const l3Emps = employees.filter((e) => e.soc_level === "L3");

  const wb = XLSX.utils.book_new();

  // L1 sheet — Morning / Noon / Night
  if (l1Emps.length > 0) {
    const ws = buildTeamSheet({ teamLabel: `L1 — ${monthLabel}`, employees: l1Emps, schedules, dates, shiftCodes: ["M", "A", "N"] });
    XLSX.utils.book_append_sheet(wb, ws, "L1 Roster");
  }

  // L2 sheet — Morning / Noon / Night
  if (l2Emps.length > 0) {
    const ws = buildTeamSheet({ teamLabel: `L2 — ${monthLabel}`, employees: l2Emps, schedules, dates, shiftCodes: ["M", "A", "N"] });
    XLSX.utils.book_append_sheet(wb, ws, "L2 Roster");
  }

  // L3 sheet — Morning / Noon only (no Night)
  if (l3Emps.length > 0) {
    const ws = buildTeamSheet({ teamLabel: `L3 — ${monthLabel}`, employees: l3Emps, schedules, dates, shiftCodes: ["M", "A"] });
    XLSX.utils.book_append_sheet(wb, ws, "L3 Roster");
  }

  // Legend sheet
  const legend = XLSX.utils.aoa_to_sheet([
    [{ v: "LEGEND", s: titleStyle() }],
    [],
    [{ v: "WD",  s: { font: { bold: true } } }, { v: "Work Day", s: rowCellStyle() }, { v: "", s: shiftCellStyle("WD") }],
    [{ v: "WO",  s: { font: { bold: true } } }, { v: "Week Off", s: rowCellStyle() }, { v: "", s: shiftCellStyle("WO") }],
    [{ v: "L",   s: { font: { bold: true } } }, { v: "Leave",    s: rowCellStyle() }, { v: "", s: shiftCellStyle("L")  }],
    [{ v: "Adj", s: { font: { bold: true } } }, { v: "Adjusted Resource", s: rowCellStyle() }, { v: "", s: shiftCellStyle("Adj") }],
    [],
    [{ v: "L3 Shift Timings", s: { font: { bold: true } } }],
    [{ v: "Morning", s: rowCellStyle() }, { v: "9:00 AM – 6:00 PM" }],
    [{ v: "Noon",    s: rowCellStyle() }, { v: "12:00 PM – 9:00 PM" }],
  ]);
  XLSX.utils.book_append_sheet(wb, legend, "Legend");

  const safe = monthLabel.replace(/\s+/g, "_");
  XLSX.writeFile(wb, `SOC_Roster_${safe}.xlsx`);
}


// ---------------------------------------------------------------------------
// WEEKLY ROSTER EXPORT (legacy manual editor)
// ---------------------------------------------------------------------------
export function exportRosterXLSX({ employees, days, getCell, weekRangeLabel }) {
  const totalCols = 3 + days.length;
  const grid = [];

  grid.push([{ v: `WEEKLY ROSTER · ${weekRangeLabel}`, s: titleStyle() }, ...Array(totalCols - 1).fill({ v: "", s: titleStyle() })]);
  grid.push(Array(totalCols).fill({ v: "" }));

  const headerRow = [
    { v: "#",  s: headerStyle() },
    { v: "EMPLOYEE", s: headerStyle() },
    { v: "EMP ID",   s: headerStyle() },
    ...days.map((d) => ({
      v: `${["MON","TUE","WED","THU","FRI","SAT","SUN"][(d.getDay()+6)%7]} · ${d.getDate()}`,
      s: headerStyle(),
    })),
  ];
  grid.push(headerRow);

  employees.forEach((emp, idx) => {
    const row = [
      { v: idx + 1, s: idStyle() },
      { v: `${emp.name} [${emp.is_secops ? "SecOps" : "SOC"}]`, s: nameStyle() },
      { v: emp.emp_id, s: rowCellStyle() },
    ];
    days.forEach((d) => {
      const cell = getCell(emp.id, d);
      const code = cell?.code || "";
      const sub  = cell?.sub_type || "";
      const text = code ? (sub ? `${code} (${sub.charAt(0)})` : code) : "";
      row.push({ v: text, s: shiftCellStyle(code) });
    });
    grid.push(row);
  });

  const ws = XLSX.utils.aoa_to_sheet(grid);
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } }];
  ws["!cols"] = [{ wch: 4 }, { wch: 26 }, { wch: 12 }, ...days.map(() => ({ wch: 14 }))];
  ws["!rows"] = grid.map((_, i) => ({ hpt: i === 0 ? 26 : 20 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Weekly Roster");
  XLSX.writeFile(wb, `weekly_roster_${weekRangeLabel.replace(/[^A-Za-z0-9]+/g, "_")}.xlsx`);
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
function titleStyle() {
  return {
    font: { name: "Calibri", sz: 14, bold: true, color: { rgb: "FF1F4E79" } },
    alignment: { horizontal: "left", vertical: "center" },
    fill: { fgColor: { rgb: "FFFFFFFF" } },
  };
}
function sectionStyle() {
  return {
    font: { name: "Calibri", sz: 12, bold: true, color: { rgb: "FFFFFFFF" } },
    alignment: { horizontal: "center", vertical: "center" },
    fill: { fgColor: { rgb: "FF305496" } },
    border: borderAll("FF305496"),
  };
}
function headerStyle() {
  return {
    font: { name: "Calibri", sz: 10, bold: true, color: { rgb: "FFFFFFFF" } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    fill: { fgColor: { rgb: "FF4472C4" } },
    border: borderAll("FF4472C4"),
  };
}
function weekendHeaderStyle() {
  return {
    font: { name: "Calibri", sz: 10, bold: true, color: { rgb: "FF111111" } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    fill: { fgColor: { rgb: "FFFCE4D6" } },
    border: borderAll("FF4472C4"),
  };
}
function rowCellStyle() {
  return {
    font: { name: "Calibri", sz: 10, color: { rgb: "FF111111" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: borderAll("FFCCCCCC"),
  };
}
function nameStyle() {
  return {
    font: { name: "Calibri", sz: 10, bold: true, color: { rgb: "FF000000" } },
    alignment: { horizontal: "left", vertical: "center", indent: 1 },
    border: borderAll("FFCCCCCC"),
  };
}
function secopsNameStyle() {
  return {
    font: { name: "Calibri", sz: 10, bold: true, color: { rgb: "FFFF6600" } },
    alignment: { horizontal: "left", vertical: "center", indent: 1 },
    border: borderAll("FFCCCCCC"),
  };
}
function teamStyle() {
  return {
    font: { name: "Calibri", sz: 10, bold: true, color: { rgb: "FF305496" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: borderAll("FFCCCCCC"),
  };
}
function secopsTeamStyle() {
  return {
    font: { name: "Calibri", sz: 10, bold: true, color: { rgb: "FF6D4C00" } },
    alignment: { horizontal: "center", vertical: "center" },
    fill: { fgColor: { rgb: "FFFFE699" } },
    border: borderAll("FFCCCCCC"),
  };
}
function idStyle() {
  return {
    font: { name: "Calibri", sz: 10, bold: true, color: { rgb: "FF111111" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: borderAll("FFCCCCCC"),
  };
}
function totalStyle() {
  return {
    font: { name: "Calibri", sz: 10, bold: true, color: { rgb: "FF111111" } },
    alignment: { horizontal: "center", vertical: "center" },
    fill: { fgColor: { rgb: "FFEAEAEA" } },
    border: borderAll("FFCCCCCC"),
  };
}
function shiftCellStyle(code, isWeekend = false) {
  const argb = isWeekend && (code === "WD" || code === "Adj") ? "FFE2EFDA" : shiftBgArgb(code);
  return {
    font: { name: "Calibri", sz: 10, bold: true, color: { rgb: shiftFgColor(code) } },
    alignment: { horizontal: "center", vertical: "center" },
    fill: { fgColor: { rgb: argb } },
    border: borderAll("FFCCCCCC"),
  };
}
function borderAll(rgb) {
  const b = { style: "thin", color: { rgb } };
  return { top: b, bottom: b, left: b, right: b };
}
