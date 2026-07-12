// import.js — tolerant CSV/paste parsing for balance updates, plus backup
// serialization. Pure functions, no DOM: everything here is unit-testable.
//
// The primary source is Monarch Money, whose balance exports are per-account
// CSVs with Date/Balance columns (account name sometimes present, sometimes
// not). People also paste rows straight from a spreadsheet, so the parser
// sniffs delimiters and finds columns by header name rather than position.

/* ------------------------- value parsing ------------------------- */

export function parseMoney(raw) {
  if (raw == null) return NaN;
  let s = String(raw).trim();
  if (!s) return NaN;
  const negative = /^\(.*\)$/.test(s);
  s = s.replace(/[()$,\s]/g, "").replace(/^\+/, "");
  if (!/^-?\d*\.?\d+$/.test(s)) return NaN;
  const v = Number(s);
  return negative ? -Math.abs(v) : v;
}

function parseDateLoose(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!/\d/.test(s)) return null; // V8's Date.parse accepts surprising junk
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/* --------------------------- CSV core ----------------------------- */

// Split one line into cells honoring double-quoted fields.
function splitLine(line, delim) {
  const cells = [];
  let cur = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      cells.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

// Tab and semicolon are listed before comma so they win ties — a tab in the
// line is almost certainly the real delimiter, while commas also appear
// inside dollar amounts.
function sniffDelimiter(line) {
  const counts = ["\t", ";", ","].map((d) => ({
    d, count: splitLine(line, d).length,
  }));
  counts.sort((a, b) => b.count - a.count);
  return counts[0].count > 1 ? counts[0].d : ",";
}

// Pasted comma rows often carry unquoted thousands separators
// ("Vanguard, $812,345"), which splits the amount across cells. Re-join any
// cell ending in a digit with a following bare 3-digit group.
function repairThousands(cells) {
  for (let i = 0; i < cells.length - 1; ) {
    // Left side must itself read as money (so "2026-07-01" never absorbs a
    // legitimate 3-digit balance in the next column).
    if (Number.isFinite(parseMoney(cells[i])) && /^\d{3}(\.\d+)?$/.test(cells[i + 1])) {
      cells.splice(i, 2, cells[i] + "," + cells[i + 1]);
    } else {
      i++;
    }
  }
  return cells;
}

/* ------------------------ balance parsing ------------------------- */

const BALANCE_RE = /balance|amount|value|total/i;
const ACCOUNT_RE = /account|name|holding|asset/i;
const DATE_RE = /date|as of|asof/i;

// → [{ account: string|null, balance: number, date: number|null }]
// One row per account, latest date winning when a date column exists.
export function parseBalancesCSV(text) {
  const lines = String(text).split(/\r\n|\r|\n/).filter((l) => l.trim() !== "");
  if (!lines.length) return [];

  const delim = sniffDelimiter(lines[0]);
  let rows = lines.map((l) => {
    const cells = splitLine(l, delim);
    return delim === "," ? repairThousands(cells) : cells;
  });

  // Header detection: a first row whose cells include a recognizable
  // balance-ish header and no parseable number.
  const first = rows[0];
  const headerish = first.some((c) => BALANCE_RE.test(c) || ACCOUNT_RE.test(c) || DATE_RE.test(c))
    && !first.some((c) => Number.isFinite(parseMoney(c)) && !/^\d{4}$/.test(c.trim()));

  let balCol, acctCol = -1, dateCol = -1;
  if (headerish) {
    const header = first;
    rows = rows.slice(1);
    dateCol = header.findIndex((c) => DATE_RE.test(c));
    acctCol = header.findIndex((c, i) => i !== dateCol && ACCOUNT_RE.test(c));
    balCol  = header.findIndex((c, i) => i !== dateCol && i !== acctCol && BALANCE_RE.test(c));
    if (balCol < 0) balCol = header.length - 1; // fall back to last column
  } else {
    // Headerless: assume the last numeric column is the balance; a leading
    // date-looking column is the date; any other text column is the account.
    const probe = rows[0];
    balCol = probe.length - 1;
    for (let i = probe.length - 1; i >= 0; i--) {
      if (Number.isFinite(parseMoney(probe[i]))) { balCol = i; break; }
    }
    for (let i = 0; i < probe.length; i++) {
      if (i === balCol) continue;
      if (parseDateLoose(probe[i]) != null && dateCol < 0) dateCol = i;
      else if (acctCol < 0 && probe[i] && !Number.isFinite(parseMoney(probe[i]))) acctCol = i;
    }
  }

  const parsed = [];
  for (const cells of rows) {
    const balance = parseMoney(cells[balCol]);
    if (!Number.isFinite(balance)) continue; // skip summary/blank rows
    parsed.push({
      account: acctCol >= 0 && cells[acctCol] ? cells[acctCol] : null,
      balance,
      date: dateCol >= 0 ? parseDateLoose(cells[dateCol]) : null,
    });
  }

  // Collapse to one row per account: latest date wins; without dates, the
  // last row wins (files are usually chronological).
  const byAccount = new Map();
  for (const row of parsed) {
    const key = row.account == null ? " single" : row.account.toLowerCase();
    const prev = byAccount.get(key);
    if (!prev || (row.date ?? Infinity) >= (prev.date ?? -Infinity)) {
      byAccount.set(key, row);
    }
  }
  return [...byAccount.values()];
}

/* ------------------------ applying updates ------------------------ */

export const IMPORT_TARGETS = [
  { key: "cash",    label: "Cash / banking" },
  { key: "taxable", label: "Taxable brokerage" },
  { key: "pretax",  label: "Pre-tax 401(k)/IRA" },
  { key: "hsa",     label: "HSA" },
  { key: "roth",    label: "Roth" },
  { key: "gold",    label: "Gold" },
  { key: "silver",  label: "Silver" },
  { key: "bitcoin", label: "Bitcoin" },
  { key: "ignore",  label: "Ignore" },
];

const HARD_KEYS = new Set(["gold", "silver", "bitcoin"]);

// mapping: { [accountNameLowercase]: targetKey }. Accounts mapped to the same
// target are summed. Targets nothing maps to are left untouched.
export function applyBalances(inputs, rows, mapping) {
  const out = structuredClone(inputs);
  const totals = {};
  const unmapped = [];

  for (const row of rows) {
    const key = row.account == null ? null : row.account.toLowerCase();
    const target = key == null ? mapping[" single"] : mapping[key];
    if (!target || target === "ignore") {
      if (!target) unmapped.push(row.account ?? "(single-account file)");
      continue;
    }
    totals[target] = (totals[target] ?? 0) + row.balance;
  }

  for (const [target, total] of Object.entries(totals)) {
    if (HARD_KEYS.has(target)) {
      const asset = out.hardAssets.find((a) => a.key === target);
      if (asset) asset.value = total;
    } else {
      out.buckets[target] = total;
    }
  }
  return { inputs: out, applied: totals, unmapped };
}

/* --------------------------- backup ------------------------------- */

const BACKUP_APP = "retirement-bridge-calculator";

export function serializeBackup(state) {
  return JSON.stringify({
    app: BACKUP_APP,
    version: 2,
    exportedAt: new Date().toISOString(),
    inputs: state.inputs,
    ui: state.ui,
    snapshots: state.snapshots ?? [],
    mappings: state.mappings ?? {},
    meta: state.meta ?? {},
  }, null, 2);
}

export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error("That file isn't valid JSON."); }
  if (data?.app !== BACKUP_APP) {
    throw new Error("That file doesn't look like a backup from this calculator.");
  }
  if (!data.inputs?.profile || !data.inputs?.buckets) {
    throw new Error("Backup is missing its inputs — it may be corrupted.");
  }
  return {
    inputs: data.inputs,
    ui: data.ui ?? null,
    snapshots: Array.isArray(data.snapshots) ? data.snapshots : [],
    mappings: data.mappings ?? {},
    meta: data.meta ?? {},
  };
}
