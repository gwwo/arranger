import { getDaysInMonth, getDaysInYear } from "$lib/components/calendar/utils";
import {
  CalendarDate,
  today,
  getLocalTimeZone,
  getDayOfWeek,
  type DayOfWeek,
  startOfWeek,
  setLocalTimeZone,
  now,
} from "@internationalized/date";

const firstDayOfWeek: DayOfWeek = "mon";

type VFn<T> = (m: RegExpMatchArray) => T;
type Pattern<T> = {
  label: string;
  regex: RegExp;
  v: T | VFn<T>;
};
function isVFn<T>(v: T | VFn<T>): v is VFn<T> {
  return typeof v === "function";
}

const join = (patterns: { regex: RegExp }[]) =>
  `(${patterns.map(({ regex }) => regex.source.replace(/\((?!\?)/g, "(?:")).join(")|(")})`;

function gather<T>(
  str: string,
  patterns: Pattern<T>[],
  startIndex: number,
  multiple: boolean = false,
) {
  const ps: { label: string; v: T }[] = [];
  // patterns[startIndex] will definitely match
  const { label, regex, v } = patterns[startIndex];
  if (isVFn(v)) {
    const m = str.match(new RegExp(`^(?:${regex.source})$`));
    ps.push({ label, v: v(m!) });
  } else {
    ps.push({ label, v });
  }
  if (!multiple) return ps;
  for (let j = startIndex + 1; j < patterns.length; ++j) {
    const { label, regex, v } = patterns[j];
    const m = str.match(new RegExp(`^(?:${regex.source})$`));
    if (m) {
      ps.push({ label, v: isVFn(v) ? v(m) : v });
    }
  }
  return ps;
}

const ordinalNamePatterns: Pattern<number>[] = [
  { label: "fir_st", regex: /fir(?:s|st)?/, v: 1 },
  { label: "sec_ond", regex: /sec(?:o|on|ond)?/, v: 2 },
  { label: "thi_rd", regex: /thi(?:r|rd)?/, v: 3 },
  { label: "fou_rth", regex: /fou(?:r|rt|rth)?/, v: 4 },
  { label: "fif_th", regex: /fif(?:t|th)?/, v: 5 },
  { label: "six_th", regex: /six(?:t|th)?/, v: 6 },
  { label: "sev_enth", regex: /sev(?:e|en|ent|enth)?/, v: 7 },
  { label: "eig_hth", regex: /eig(?:h|ht|hth)?/, v: 8 },
  { label: "nin_th/nin_eth", regex: /nin(?:t|th|e|et|eth)?/, v: 9 },
  { label: "ten_th", regex: /ten(?:t|th)/, v: 10 },
  { label: "ele_venth", regex: /ele(?:v|ve|ven|vent|venth)?/, v: 11 },
  {
    label: "twel_fth/twel_veth",
    regex: /\btwel(?:v|ve|vet|veth|f|ft|fth)?\b/,
    v: 12,
  },
];

export const cardinalNamePatterns: Pattern<number>[] = [
  { label: "one", regex: /one|a|an/, v: 1 },
  { label: "two", regex: /two/, v: 2 },
  { label: "thr_ee", regex: /thr(?:e|ee)?/, v: 3 },
  { label: "fou_r", regex: /fou(?:r)?/, v: 4 },
  { label: "fiv_e", regex: /fiv(?:e)?/, v: 5 },
  { label: "six", regex: /six/, v: 6 },
  { label: "sev_en", regex: /sev(?:e|en)?/, v: 7 },
  { label: "eig_ht", regex: /eig(?:h|ht)?/, v: 8 },
  { label: "nin_e", regex: /nin(?:e)?/, v: 9 },
  { label: "ten", regex: /ten/, v: 10 },
  { label: "ele_ven", regex: /ele(?:v|ve|ven)?/, v: 11 },
  { label: "twel_ve", regex: /twel(?:v|ve)?/, v: 12 },
];

export const parseDayCertain = (
  input: string,
): ({ v: number } & Labelable & SegmentInfo) | undefined => {
  const patterns: Pattern<number>[] = [
    ...ordinalNamePatterns,
    {
      label: "1-31th",
      regex: /([1-9]|[1-2][0-9]|3[01])(?:st|nd|rd|th)/,
      v: (m) => parseInt(m[1], 10),
    },
    {
      label: "13-31",
      regex: /(1[3-9]|2[0-9]|3[01])/,
      v: (m) => parseInt(m[1], 10),
    },
  ];
  const concurred = new RegExp(`\\b(?:${join(patterns)})\\b`, "d");
  const m = concurred.exec(input);
  if (m == undefined) return;
  const [i] = getMatchedIndices(m);
  const [cand] = gather(m[i], patterns, i - 1);
  return { index: m.indices![0]!, ...cand };
};

export const parseDayOrMonth = (
  input: string,
): ({ v: number } & Labelable & SegmentInfo) | undefined => {
  const m = /\b(0?[1-9]|10|11|12)\b/d.exec(input);
  if (m == undefined) return;
  return { index: m.indices![0]!, label: "0?1-12", v: parseInt(m[1], 10) };
};

export const parseYear = (input: string): ({ v: number } & Labelable & SegmentInfo) | undefined => {
  const m = /\b(2\d\d\d|19\d\d)\b/d.exec(input);

  if (m == undefined) return;

  return { index: m.indices![0]!, label: "20xx", v: parseInt(m[1], 10) };
};
export type Duration = "day" | "week" | "month" | "year";

const durationNamePatterns: Pattern<Duration>[] = [
  { label: "days/dys/ds", regex: /d|da$|day|days|dy|dys|ds/, v: "day" },
  {
    label: "weeks/wks/ws",
    regex: /w|we$|wee$|week|weeks|wk|wks|ws/,
    v: "week",
  },
  { label: "m", regex: /m/, v: "month" },
  {
    label: "months/mths/ms",
    regex: /mo$|mont$|month|months|mth|mths|ms/,
    v: "month",
  },
  {
    label: "years/yrs/ys",
    regex: /y|ye$|yea$|year|years|yr|yrs|ys/,
    v: "year",
  },
];

export const parseMonthCertain = (
  input: string,
): ({ v: number } & Labelable & SegmentInfo) | undefined => {
  const patterns = [
    { label: "jan_uary", regex: /jan(?:u|ua|uar|uary)?/, v: 1 },
    { label: "feb_ruary", regex: /feb(?:r|ru|rua|ruar|ruary)?/, v: 2 },
    { label: "mar_ch", regex: /mar(?:c|ch)?/, v: 3 },
    { label: "apr_il", regex: /apr(?:i|il)?/, v: 4 },
    { label: "may", regex: /may/, v: 5 },
    { label: "jun_e", regex: /jun(?:e)?/, v: 6 },
    { label: "jul_y", regex: /jul(?:y)?/, v: 7 },
    { label: "aug_ust", regex: /aug(?:u|us|ust)?/, v: 8 },
    {
      label: "sep_tember",
      regex: /sep(?:t|te|tem|temb|tembe|tember)?/,
      v: 9,
    },
    { label: "oct_ober", regex: /oct(?:o|ob|obe|ober)?/, v: 10 },
    { label: "nov_ember", regex: /nov(?:e|em|emb|embe|ember)?/, v: 11 },
    { label: "dec_ember", regex: /dec(?:e|em|emb|embe|ember)?/, v: 12 },
  ];
  const concurred = new RegExp(`\\b(?:${join(patterns)})\\b`, "d");
  const m = concurred.exec(input);
  if (m == undefined) return;
  const [i] = getMatchedIndices(m);
  const [month] = gather(m[i], patterns, i - 1);
  return { index: m.indices![0]!, ...month };
};

export const parseMonthNamePartial = (
  input: string,
):
  | ({
      cands: ({ v: number } & Labelable)[];
    } & SegmentInfo)
  | undefined => {
  const patterns: Pattern<number>[] = [
    { label: "ja(nuary", regex: /j|ja/, v: 1 },
    { label: "fe(bruary", regex: /f|fe/, v: 2 },
    { label: "ma(rch", regex: /m|ma/, v: 3 },
    { label: "ap(ril", regex: /a|ap/, v: 4 },
    { label: "ma(y", regex: /m|ma/, v: 5 },
    { label: "ju(ne", regex: /j|ju/, v: 6 },
    { label: "ju(ly", regex: /j|ju/, v: 7 },
    { label: "au(gust", regex: /a|au/, v: 8 },
    { label: "se(ptember", regex: /s|se/, v: 9 },
    { label: "oc(tober", regex: /o|oc/, v: 10 },
    { label: "no(vember", regex: /n|no/, v: 11 },
    { label: "de(cember", regex: /d|de/, v: 12 },
  ];
  const concurred = new RegExp(`\\b(?:${join(patterns)})$`, "d");
  const m = concurred.exec(input);
  if (!m) return;
  const [i] = getMatchedIndices(m);
  const cands = gather(m[i], patterns, i - 1, true);
  return { index: m.indices![0]!, cands };
};

type Labelable = { label?: string };

function span(...slices: (SegmentInfo | undefined)[]): [number, number] {
  let start: number | undefined;
  let end: number | undefined;
  for (const slice of slices) {
    if (slice === undefined) continue;
    const [s, e] = slice.index;
    if (start === undefined || s < start) start = s;
    if (end === undefined || e > end) end = e;
  }
  if (start === undefined || end === undefined) {
    throw new Error("no slices");
  }
  return [start, end];
}

export const listDaysOfWeek: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export function parseYMD(
  input: string,
  prepared: {
    year?: { v: number } & Labelable & SegmentInfo;
    monthCertain?: { v: number } & Labelable & SegmentInfo;
    dayCertain?: { v: number } & Labelable & SegmentInfo;
    dayOrMonth?: { v: number } & Labelable & SegmentInfo;
  } = {},
):
  | ({
      year?: { v: number } & Labelable & SegmentInfo;
      month: { v: number } & Labelable & SegmentInfo;
      day: { v: number } & Labelable & SegmentInfo;
    } & SegmentInfo)
  | undefined {
  const year = prepared.year ?? parseYear(input);
  const monthCertain = prepared.monthCertain ?? parseMonthCertain(input);
  const dayCertain = prepared.dayCertain ?? parseDayCertain(input);
  const dayOrMonth = prepared.dayOrMonth ?? parseDayOrMonth(input);

  // $year? $month-certain $day
  const day = dayCertain ?? dayOrMonth;
  if (monthCertain && day) {
    const index = span(year, monthCertain, day);
    return { index, year, month: monthCertain, day };
  }

  // $year? $day-certain $month-or-day
  const monthOrDay = dayOrMonth;
  if (dayCertain && monthOrDay) {
    const index = span(year, dayCertain, monthOrDay);
    return { index, year, month: monthOrDay, day: dayCertain };
  }

  // $year? $month-or-day $day-or-month
  if (monthOrDay) {
    const [_, end] = monthOrDay.index;
    const dayOrMonth = parseDayOrMonth(input.slice(end));
    if (dayOrMonth) {
      dayOrMonth.index[0] += end;
      dayOrMonth.index[1] += end;
      const yeaerAppearNotLast = year && year.index[0] < dayOrMonth.index[0];
      const [month, day] = yeaerAppearNotLast
        ? // 2 2026 3 => feb 3
          // 2026 2 3 => feb 3
          [monthOrDay, dayOrMonth]
        : // 2 3 => mar 2
          // 2 3 2026 => mar 3
          [dayOrMonth, monthOrDay];
      const index = span(year, monthOrDay, dayOrMonth);
      return { index, year, month, day };
    }
  }
}

export function parseMaybeYMD(str: string):
  | {
      year?: { v: number };
      months?: { v: number }[];
      day?: { v: number };
    }
  | undefined {
  const year = parseYear(str);
  const dayCertain = parseDayCertain(str);
  const dayOrMonth = parseDayOrMonth(str);
  const monthOrDay = dayOrMonth;
  const day = dayCertain ?? dayOrMonth;
  const monthPartial = parseMonthNamePartial(str);
  // y? d? m-partial
  if (monthPartial) {
    return { year, months: monthPartial.cands, day };
  }
  // y m-or-d?
  if (year) {
    return monthOrDay ? { year, months: [monthOrDay] } : { year };
  }
  // d
  if (day) return { day };
}

type Range = {
  dur: Duration;
  start: CalendarDate;
};

export function parseRangeOrdDur(
  input: string,
  segments: [number, number][],
  ordDuration: {
    ordinal: { v: number };
    duration: { v: Duration };
  } & SegmentInfo,
): (Range & { yearSpecified: boolean } & SegmentInfo) | undefined {
  const [start, end] = ordDuration.index;
  const {
    ordinal: { v: ord },
    duration: { v: dur },
  } = ordDuration;
  if (dur === "year") return;

  for (const [s, e] of segments) {
    const adjacent = e === start || s === end;
    if (!adjacent) continue;
    const str = input.slice(s, e);
    const monthCertain = parseMonthCertain(str);
    const year = parseYear(str);

    const month = monthCertain && dur === "month" ? undefined : monthCertain;
    if (!month && !year) continue;

    const yearSpecified = year != undefined;
    const base = span(month, year);
    const index: [number, number] = e === start ? [s + base[0], end] : [start, s + base[1]];

    const date = getDateConcrete(year?.v, month?.v);
    const startDate =
      dur === "week"
        ? startOfWeek(date, "", firstDayOfWeek).add({
            weeks: ord - 1,
          })
        : date.add({ [`${dur}s`]: ord - 1 });

    return { index, dur, start: startDate, yearSpecified };
  }
}

export function parseRange(
  input: string,
  segments: [number, number][],
): (Range & { yearSpecified: boolean } & SegmentInfo) | undefined {
  for (let i = 0; i < segments.length; i++) {
    const [s, e] = segments[i];
    const str = input.slice(s, e);
    const year = parseYear(str);
    const monthCertain = parseMonthCertain(str);
    const p = parseYMD(str, { year, monthCertain });
    const { month, day } = p ?? { month: monthCertain };
    if (year || month || day) {
      // `year && day && !month` won't happen
      const date = getDateConcrete(year?.v, month?.v, day?.v);
      const dur: Duration = month ? (day ? "day" : "month") : "year";
      const [start, end] = span(year, month, day);
      const yearSpecified = year != undefined;
      return { index: [start + s, end + s], dur, yearSpecified, start: date };
    }
  }
}

export function getDayofWInRange(
  wkd: DayOfWeek,
  range?: Range,
): { first: CalendarDate; max?: number } {
  const start = range?.start ?? today(getLocalTimeZone());
  const n = listDaysOfWeek.indexOf(wkd);
  const k = getDayOfWeek(start, "", firstDayOfWeek);
  const first = start.add({ days: n >= k ? n - k : n + 7 - k });
  if (!range || range.dur === "day") return { first };
  if (range.dur === "week") return { first, max: 1 };
  const total =
    range.dur === "month" ? getDaysInMonth(first.month, first.year) : getDaysInYear(first.year);
  const max = Math.ceil((total - first.day + 1) / 7);
  return { first, max };
}

export const inOrder = (first: SegmentInfo, ...rest: SegmentInfo[]) => {
  let prevEnd = first.index[1];
  for (const seg of rest) {
    if (seg.index[0] < prevEnd) return false;
    prevEnd = seg.index[1];
  }
  return true;
};

type AmountDuration = {
  past: boolean;
  row: {
    amount: { v: number } & Labelable;
    duration: { v: Duration } & Labelable;
  }[];
};

type OrdinalDayOfWeek = {
  ordinal?: { v: number } & SegmentInfo & Labelable;
  dayofweek: { v: DayOfWeek } & SegmentInfo & Labelable;
};

export function parseOrdinalDayofW(input: string): (OrdinalDayOfWeek & SegmentInfo) | undefined {
  const ordinalPatterns: Pattern<number>[] = [
    ...ordinalNamePatterns,
    {
      label: "d+_th",
      regex: /(\d+)(?:st|nd|rd|th)/,
      v: (m) => parseInt(m[1], 10),
    },
  ];

  const dowPatterns: Pattern<DayOfWeek>[] = [
    { label: "mon_day", regex: /mon(?:d|da|day)?/, v: "mon" },
    { label: "tue_sday", regex: /tue(?:s|sd|sda|sday)?/, v: "tue" },
    {
      label: "wed_nesday",
      regex: /wed(?:n|ne|nes|nesd|nesda|nesday)?/,
      v: "wed",
    },
    { label: "thu_rsday", regex: /thu(?:r|rs|rsd|rsda|rsday)?/, v: "thu" },
    { label: "fri_day", regex: /fri(?:d|da|day)?/, v: "fri" },
    { label: "sat_urday", regex: /sat(?:u|ur|urd|urda|urday)?/, v: "sat" },
    { label: "sun_day", regex: /sun(?:d|da|day)?/, v: "sun" },
  ];

  const gathered = gatherABorB(input, ordinalPatterns, dowPatterns);
  if (gathered == undefined) return;
  const { index, a, b } = gathered;
  return { index, ordinal: a, dayofweek: b };
}

type OrdinalDuration = {
  ordinal: { v: number } & SegmentInfo & Labelable;
  duration: { v: Duration } & SegmentInfo & Labelable;
};

export function parseOrdinalDuration(input: string): (OrdinalDuration & SegmentInfo) | undefined {
  const ordinalPatterns: Pattern<number>[] = [
    ...ordinalNamePatterns,
    {
      label: "d+_th",
      regex: /(\d+)(?:st|nd|rd|th)/,
      v: (m) => parseInt(m[1], 10),
    },
  ];

  const regex = new RegExp(
    `\\b(?:${join(ordinalPatterns)})\\s+(?:${join(durationNamePatterns)})\\b`,
    "d",
  );

  const gathered = gatherABorB(input, ordinalPatterns, durationNamePatterns, regex);
  if (gathered == undefined) return;
  const { index, a, b } = gathered;
  if (a && b) return { index, ordinal: a, duration: b };
}

type SegmentInfo = { index: [number, number] };

function gatherABorB<A, B>(
  input: string,
  patternsA: Pattern<A>[],
  patternsB: Pattern<B>[],
  regex?: RegExp,
):
  | ({
      a?: { v: A } & SegmentInfo & Labelable;
      b: { v: B } & SegmentInfo & Labelable;
    } & SegmentInfo)
  | undefined {
  const combined = regex?.flags.includes("d")
    ? regex
    : new RegExp(
        regex?.source ?? `\\b(?:(?:${join(patternsA)})\\s+)?(?:${join(patternsB)})\\b`,
        (regex?.flags ?? "") + "d", // get the indices of capturing groups
      );

  const m = combined.exec(input);
  if (m == undefined) return;
  const { indices } = m;
  if (indices == undefined) return;

  const index = indices[0]!;
  const [i, j] = getMatchedIndices(m) as [number | undefined, number | undefined];

  if (i != undefined && j != undefined) {
    const [a] = gather(m[i], patternsA, i - 1);
    const [b] = gather(m[j], patternsB, j - 1 - patternsA.length);
    return {
      index,
      a: { index: indices[i]!, ...a },
      b: { index: indices[j]!, ...b },
    };
  }
  if (i != undefined) {
    const [b] = gather(m[i], patternsB, i - 1 - patternsA.length);
    return { index, b: { index: indices[i]!, ...b } };
  }
}

function getMatchedIndices(m: RegExpExecArray | RegExpMatchArray) {
  return m.flatMap((str, idx) => (idx > 0 && str ? [idx] : []));
}

export function parseDayofWPartial(input: string) {
  const patterns: Pattern<DayOfWeek>[] = [
    { label: "mo(nday", regex: /m|mo/, v: "mon" },
    { label: "tu(esday", regex: /t|tu/, v: "tue" },
    { label: "we(dnesday", regex: /w|we/, v: "wed" },
    { label: "th(ursday", regex: /t|th/, v: "thu" },
    { label: "fr(iday", regex: /f|fr/, v: "fri" },
    { label: "sa(turday", regex: /s|sa/, v: "sat" },
    { label: "su(nday", regex: /s|su/, v: "sun" },
  ];
  const concurred = new RegExp(`^\s*(?:${join(patterns)})$`, "d");
  const m = concurred.exec(input);
  if (!m) return;
  const [i] = getMatchedIndices(m);
  const cands = gather(m[i], patterns, i - 1, true);
  return { index: m.indices![0], cands };
}

export function parseSoleAmount(input: string): ({ v: number } & Labelable) | undefined {
  // maximum 999
  const digitPatterns: Pattern<number>[] = [
    { label: "\\d+", regex: /0*([1-9]\d{0,2})/, v: (m) => parseInt(m[0], 10) },
  ];
  const amountPatterns = [...cardinalNamePatterns, ...digitPatterns];
  const concurred = new RegExp(`^\\s*(?:${join(amountPatterns)})\\s*$`, "d");
  const m = concurred.exec(input);
  if (!m) return;
  const [i] = getMatchedIndices(m);
  const [amount] = gather(m[i], amountPatterns, i - 1);
  return amount;
}

export function parseAmountDuration(input: string): (AmountDuration & SegmentInfo) | undefined {
  // maximum 9999 days, 999 weeks, 999 months, 99 years.
  const digitPatterns: Pattern<number>[] = [
    {
      label: "\\d+",
      regex: /0*(0|[1-9]\d{0,3})/,
      v: (m) => parseInt(m[0], 10),
    },
  ];
  const amountPatterns = [...cardinalNamePatterns, ...digitPatterns];
  const sourceCard = join(cardinalNamePatterns);
  const sourceDigit = join(digitPatterns);
  const sourceDur = join(durationNamePatterns);

  const concurred = new RegExp(`\\b(?:(?:${sourceCard})\\s|${sourceDigit})\\s*(?:${sourceDur})\\b`);
  const followed = new RegExp(`^(?:\\s*|\\s*and\\s*)${concurred.source}`);

  const row: {
    amount: { v: number } & Labelable;
    duration: { v: Duration } & Labelable;
  }[] = [];

  let start: number | null = null;
  let end = 0;
  let count = 0;
  while (count < 6) {
    const str = input.slice(end);
    if (str === "") break;

    const regex: RegExp = start === null ? concurred : followed;
    const m = str.match(regex);
    if (!m) break;

    const [i, j] = getMatchedIndices(m);
    const [amount] = gather(m[i], amountPatterns, i - 1);
    const [duration] = gather(m[j], durationNamePatterns, j - 1 - amountPatterns.length);
    const n = amount.v;
    const dur = duration.v;
    const outbound =
      (dur === "day" && n > 9999) ||
      (dur === "week" && n > 999) ||
      (dur === "month" && n > 999) ||
      (dur === "year" && n > 99);
    if (outbound) break;

    if (start === null) start = m.index!;

    row.push({ amount, duration });
    end += m.index! + m[0].length;
    count += 1;
  }

  if (start === null) return;

  const pastPs: Pattern<boolean>[] = [
    { label: "before", regex: /bef|befo|befor|before/, v: true },
    { label: "ago", regex: /ago/, v: true },
    { label: "earlier", regex: /ear|earl|earli|earlie|earlier/, v: true },
  ];

  const suffix = new RegExp(`^\\s*\\b(?:${join(pastPs)})\\b`);
  const m = input.slice(end).match(suffix);

  if (m) end += m.index! + m[0].length;

  return { row, index: [start, end], past: m !== null };
}

export function segment(input: string, ...slices: (SegmentInfo | undefined)[]) {
  const valid = slices
    .filter((s): s is SegmentInfo => s != undefined)
    .map((s) => s.index)
    .sort((a, b) => a[0] - b[0]);

  const arr: [number, number][] = [];

  let seek = 0;
  for (const [start, end] of valid) {
    if (start > seek) arr.push([seek, start]);
    if (end > seek) seek = end;
  }
  if (seek < input.length) arr.push([seek, input.length]);
  return arr;
}

export function getDateConcrete(year?: number, month?: number, day?: number): CalendarDate {
  const dateToday = today(getLocalTimeZone());

  if (month) {
    day = day ?? 1;
    if (year) return new CalendarDate(year, month, day);
    // covering this month and the last month
    const d = dateToday.set({ month, day });
    if (month - dateToday.month >= -1) return d;
    return d.add({ years: 1 });
  }

  // ignore day if year && day
  if (year) {
    return new CalendarDate(year, 1, 1);
  }

  if (day) {
    const d = dateToday.set({ day });
    if (d.compare(dateToday) > 0) return d;
    return d.add({ months: 1 });
  }

  return dateToday;
}

export function shift(date: CalendarDate, time: AmountDuration) {
  const { past, row } = time;
  const total = row.reduce(
    (acc, { amount, duration }) => {
      acc[`${duration.v}s`] += amount.v;
      return acc;
    },
    { years: 0, months: 0, weeks: 0, days: 0 },
  );
  return past ? date.subtract(total) : date.add(total);
}
