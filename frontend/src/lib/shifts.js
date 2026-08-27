// Shift code definitions & color palette (matches reference roster.py pastel scheme)

export const SHIFT_COLORS = {
  WD:  "#C6EFCE",  // light green
  WO:  "#FFF2CC",  // light yellow
  L:   "#F4CCCC",  // light pink
  Adj: "#BDD7EE",  // light blue
};

export const SHIFT_COLORS_DARK = {
  WD:  "#2E7D32",
  WO:  "#8A6D00",
  L:   "#B71C1C",
  Adj: "#1565C0",
};

export const SHIFT_LABEL = {
  WD:  "Work Day",
  WO:  "Week Off",
  L:   "Leave",
  Adj: "Adjusted",
};

export const SHIFT_OPTIONS = [
  { code: "",    label: "— Clear —" },
  { code: "WD",  label: "WD · Work Day" },
  { code: "WO",  label: "WO · Week Off" },
  { code: "L",   label: "L · Leave" },
  { code: "Adj", label: "Adj · Adjusted" },
];

export const SUBTYPE_OPTIONS = [
  { code: "",        label: "—" },
  { code: "Morning", label: "Morning" },
  { code: "Evening", label: "Evening" },
  { code: "Night",   label: "Night" },
];

// SOC employee shift codes (M / A / N)
export const SOC_SHIFTS = {
  M: { name: "Morning", display: "7AM – 3PM", color: "#FFD180" },
  A: { name: "Noon",    display: "3PM – 11PM", color: "#80D8FF" },
  N: { name: "Night",   display: "11PM – 7AM", color: "#B388FF" },
};

// L3 team uses custom shift timings (no Night shift)
export const L3_SHIFTS = {
  M: { name: "Morning", display: "9AM – 6PM", color: "#FFD180" },
  A: { name: "Noon",    display: "12PM – 9PM", color: "#80D8FF" },
};

export function shiftCellClass(code) {
  switch (code) {
    case "WD":  return "shift-wd";
    case "WO":  return "shift-wo";
    case "L":   return "shift-l";
    case "Adj": return "shift-adj";
    default:    return "shift-empty";
  }
}

// Excel ARGB (alpha + RGB) for SheetJS pastel cells
export function shiftBgArgb(code) {
  switch (code) {
    case "WD":  return "FFC6EFCE";
    case "WO":  return "FFFFF2CC";
    case "L":   return "FFF4CCCC";
    case "Adj": return "FFBDD7EE";
    default:    return "FFFFFFFF";
  }
}

export function shiftFgColor(_code) {
  // Pastel palette uses dark text for all states
  return "FF111111";
}
