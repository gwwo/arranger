import { type CalendarDate, type DayOfWeek, getDayOfWeek } from "@internationalized/date";
import {
  getDateConcrete,
  getDayofWInRange,
  inOrder,
  listDaysOfWeek,
  parseAmountDuration,
  parseDayofWPartial,
  parseMaybeYMD,
  parseOrdinalDayofW,
  parseOrdinalDuration,
  parseRange,
  parseRangeOrdDur,
  parseSoleAmount,
  segment,
  shift,
  type Duration,
} from "./utils";
import { getMonthName } from "$lib/components/calendar/utils";

type ShowDate = {
  d: CalendarDate;
  relative?: { amount: number; dur: Duration; past?: boolean } | "day";
  measure?: "day" | "week" | "month" | "year";
  dayofw?: DayOfWeek;
};

// 2027 nov, first week, fri, 2 days before
// 2026 first week fri vs 2026 first fri

function getYearDiffRough(a: CalendarDate, b: CalendarDate) {
  const yearA = a.era === "BC" ? 1 - a.year : a.year;
  const yearB = b.era === "BC" ? 1 - b.year : b.year;
  const diff = yearA - yearB + (a.month - b.month) / 12;
  const v = Math.round(diff);
  return v < 0 ? { v: -v, past: true } : { v, past: false };
}

function showYearDiffRough(v: number, past: boolean) {
  return v > 999
    ? past
      ? "> 999 years ago"
      : "in > 999 years"
    : past
      ? `~ ${v} years ago`
      : `in ~ ${v} years`;
}

// 48 months
function getMonthDiffRough(a: CalendarDate, b: CalendarDate) {
  const yearA = a.era === "BC" ? 1 - a.year : a.year;
  const yearB = b.era === "BC" ? 1 - b.year : b.year;
  const diff = (yearA - yearB) * 12 + (a.month - b.month) + (a.day - b.day) / 30;
  const v = Math.round(diff);
  return v < 0 ? { v: -v, past: true } : { v, past: false };
}

function getWeekDiffSolid(a: CalendarDate, b: CalendarDate) {
  const n = a.compare(b);
  const abs = Math.abs(n);
  const exact = abs % 7 === 0;
  const v = Math.floor(abs / 7);
  const past = n < 0;
  return { v, past, exact };
}

function getDayDiff(a: CalendarDate, b: CalendarDate) {
  const n = a.compare(b);
  return { v: Math.abs(n), past: n < 0 };
}

export const showDayofWeek = (d: CalendarDate, dayofw?: DayOfWeek) => {
  const str = dayofw ?? listDaysOfWeek[getDayOfWeek(d, "", listDaysOfWeek[0])];
  return str[0].toUpperCase() + str.slice(1);
};

function show(sd: ShowDate, today?: CalendarDate): [string, string] {
  const { d, relative, measure, dayofw } = sd;
  const td = today ?? getDateConcrete();
  const dow = showDayofWeek(d, dayofw);
  const m = getMonthName(d.month);
  const mShort = m.slice(0, 3);

  if (relative) {
    const {
      amount: v,
      dur: dur,
      past,
    } = relative === "day"
      ? (() => {
          const n = d.compare(td);
          return { amount: Math.abs(n), dur: "day" as Duration, past: n < 0 };
        })()
      : relative;
    const suffix = `${dur}${v > 1 ? "s" : ""}`;
    const l = past ? `${v} ${suffix} ago` : `in ${v} ${suffix}`;
    const r =
      dur === "day" && v < 7
        ? dow
        : d.year === td.year
          ? `${dow}, ${mShort} ${d.day}`
          : `${dow}, ${mShort} ${d.day}, ${d.year}`;
    return [l, r];
  }

  if (measure) {
    const l =
      d.year === td.year ? `${dow}, ${mShort} ${d.day}` : `${dow}, ${mShort} ${d.day}, ${d.year}`;

    const { v, past } = getYearDiffRough(d, td);

    if (measure === "day") {
      // maximum 99999 days ~ 274 years
      if (v <= 274) {
        const { v, past } = getDayDiff(d, td);
        if (v <= 99999) {
          if (v === 0) return [l, "Today"];
          const suffix = `day${v > 1 ? "s" : ""}`;
          const r = past ? `${v} ${suffix} ago` : `in ${v} ${suffix}`;
          return [l, r];
        }
      }
    } else if (measure === "week") {
      // maximum 999 weeks ~ 20 years
      if (v <= 20) {
        const { v, past, exact } = getWeekDiffSolid(d, td);
        if (v === 0) {
          const { v, past } = getDayDiff(d, td);
          if (v === 0) return [l, "Today"];
          const suffix = `day${v > 1 ? "s" : ""}`;
          const r = past ? `${v} ${suffix} ago` : `in ${v} ${suffix}`;
          return [l, r];
        }
        if (v <= 999) {
          const suffix = `week${v > 1 ? "s" : ""}`;
          const prefix = exact ? "" : "> ";
          const r = past ? `${prefix}${v} ${suffix} ago` : `in ${prefix}${v} ${suffix}`;
          return [l, r];
        }
      }
    } else if (measure === "month") {
      // maximum 999 months ~ 84 years
      if (v <= 84) {
        const { v, past } = getMonthDiffRough(d, td);
        if (v <= 1) {
          const { v, past } = getDayDiff(d, td);
          const suffix = `day${v > 1 ? "s" : ""}`;
          const r = past ? `${v} ${suffix} ago` : `in ${v} ${suffix}`;
          return [l, r];
        }
        if (v <= 999) {
          const suffix = `month${v > 1 ? "s" : ""}`;
          const r = past ? `~ ${v} ${suffix} ago` : `in ~ ${v} ${suffix}`;
          return [l, r];
        }
      }
    }
    return [l, showYearDiffRough(v, past)];
  }

  const l = d.year === td.year ? `${m} ${d.day}` : `${mShort} ${d.day}, ${d.year}`;

  const { v, past } = getYearDiffRough(d, td);

  if (v > 0 && !past) return [l, dow];
  if (v >= 4) return [l, showYearDiffRough(v, past)];

  const m_diff = getMonthDiffRough(d, td);

  if (m_diff.past && m_diff.v >= 3) {
    const suffix = `month${m_diff.v > 1 ? "s" : ""}`;
    return [l, `~ ${m_diff.v} ${suffix} ago`];
  }
  const d_diff = getDayDiff(d, td);
  if (!d_diff.past) return [l, dow];

  const suffix = `day${d_diff.v > 1 ? "s" : ""}`;
  return [l, `${d_diff.v} ${suffix} ago`];
}

export type ParseResult = { d: CalendarDate; l: string; r: string };

export function parse(input: string): ParseResult[] {
  const p = process(input);
  if (p == undefined) return [];
  const [first] = p;
  const arr =
    p.length === 1 && Array.isArray(first)
      ? first
      : p.map((cand) => (Array.isArray(cand) ? cand[0] : cand));
  const td = getDateConcrete();
  return arr.map((sd) => {
    const [l, r] = show(sd, td);
    return { d: sd.d, l, r };
  });
}

function process(input: string): (ShowDate | ShowDate[])[] | undefined {
  const ordDayofW = parseOrdinalDayofW(input);
  const amountDur = parseAmountDuration(input);
  const ordDuration = parseOrdinalDuration(input);
  let segments = segment(input, ordDayofW, amountDur, ordDuration);

  const rangeOrdDur = ordDuration ? parseRangeOrdDur(input, segments, ordDuration) : undefined;
  let range = rangeOrdDur;

  if (rangeOrdDur == undefined) {
    segments = segment(input, ordDayofW, amountDur);
    range = parseRange(input, segments);
  }

  if ((range?.dur === "month" || range?.dur === "year") && ordDayofW?.ordinal) {
    const { ordinal, dayofweek } = ordDayofW;
    const { first, max } = getDayofWInRange(dayofweek.v, range);
    if (ordinal.v <= max!) {
      const date = ordinal.v === 1 ? first : first.add({ weeks: ordinal.v - 1 });
      const adAppearSide =
        amountDur &&
        !(inOrder(ordDayofW, amountDur, range) || inOrder(range, amountDur, ordDayofW));
      if (adAppearSide) {
        return [{ d: shift(date, amountDur), measure: "day" }];
      }
      // oct 3th fri, 2027 34th fri, 2th month 2028 2th fri
      // if month clear, no need to show measure
      const measure = rangeOrdDur == undefined && range.dur === "month" ? undefined : "week";
      return [{ d: date, measure, dayofw: dayofweek.v }];
    }
  }

  const { dayofweek } = ordDayofW ?? {};
  if (ordDayofW?.ordinal && rangeOrdDur == undefined) {
    segments = segment(input, dayofweek, amountDur);
    range = parseRange(input, segments);
  }

  if (dayofweek && amountDur) {
    if (range == undefined || range.dur === "day") {
      const date = range?.start ?? getDateConcrete();
      const shiftADFirst = range
        ? inOrder(dayofweek, amountDur, range) ||
          inOrder(range, amountDur, dayofweek) ||
          inOrder(amountDur, range, dayofweek)
        : inOrder(amountDur, dayofweek);
      const start = shiftADFirst ? shift(date, amountDur) : date;
      const { first } = getDayofWInRange(dayofweek.v, { start, dur: "day" });
      if (shiftADFirst) {
        return [{ d: first, dayofw: dayofweek.v, measure: "day" }];
      }
      return [{ d: shift(first, amountDur), measure: "day" }];
    }
    if (range.dur === "week") {
      const adAppearSide = !(
        inOrder(dayofweek, amountDur, range) || inOrder(range, amountDur, dayofweek)
      );
      if (adAppearSide) {
        const { first } = getDayofWInRange(dayofweek.v, range);
        return [{ d: shift(first, amountDur), measure: "day" }];
      }
    }
  }

  if (range && dayofweek) {
    const { first, max } = getDayofWInRange(dayofweek.v, range);
    const dayofw = dayofweek.v;
    const measure = !rangeOrdDur && range.dur === "month" ? undefined : "week";
    const cands: ShowDate[] = [{ d: first, measure, dayofw }];
    if (range.dur === "month") {
      for (let i = 1; i <= max! - 1; i++) {
        cands.push({ d: first.add({ weeks: i }), measure, dayofw });
      }
    }
    return cands;
  }

  if (range && range.dur === "day" && amountDur) {
    return [{ d: shift(range.start, amountDur), measure: "day" }];
  }

  if (rangeOrdDur && rangeOrdDur.dur === "week") {
    const { start } = rangeOrdDur;
    const first = amountDur ? shift(start, amountDur) : start;
    const dow_i = amountDur ? getDayOfWeek(first, "", listDaysOfWeek[0]) : 0;
    const measure = amountDur ? "day" : undefined;
    const cands: ShowDate[] = [{ d: first, measure, dayofw: listDaysOfWeek[dow_i] }];
    for (let i = 1; i <= 6; i++) {
      const dayofw = listDaysOfWeek[(dow_i + i) % 7];
      cands.push({ d: first.add({ days: i }), measure, dayofw });
    }
    return cands;
  }

  // will parse amountDur as long as there's one.

  const parallel: (ShowDate | ShowDate[])[] = [];

  if (dayofweek) {
    const { first } = getDayofWInRange(dayofweek.v);
    const dayofw = dayofweek.v;
    const measure = "week";
    const cands: ShowDate[] = [{ d: first, dayofw, measure }];
    for (let i = 1; i <= 2; i++) {
      cands.push({ d: first.add({ weeks: i }), dayofw, measure });
    }
    parallel.push(cands);
  }

  if (amountDur) {
    const d = shift(getDateConcrete(), amountDur);
    const { row, index, past } = amountDur;
    const relative =
      row.length === 1 ? { amount: row[0].amount.v, dur: row[0].duration.v, past } : "day";
    parallel.push({ d, relative });
    if (!past && row.length === 1 && row[0].duration.label === "m" && index[1] === input.length) {
      segments = segment(input, dayofweek);
    }
  }

  const lastSeg = segments.at(-1);

  const lastSegAtEnd = lastSeg != undefined && lastSeg[1] === input.length;
  if (range) {
    const { start, dur, yearSpecified, index } = range;
    const yearRangeAtEnd = lastSegAtEnd && dur === "year" && index[0] >= lastSeg[0];
    if (!yearRangeAtEnd) {
      const measure = rangeOrdDur ? dur : undefined;
      const cands: ShowDate[] = [{ d: start, measure }];
      if ((dur == "month" || (dur === "day" && !rangeOrdDur)) && !yearSpecified) {
        for (let i = 1; i <= 2; i++) {
          cands.push({ d: start.add({ years: i }), measure });
        }
      }
      parallel.push(cands);
      return parallel;
    }
  }

  if (!lastSegAtEnd) return parallel;

  const str = input.slice(lastSeg[0]);

  if (!dayofweek && !amountDur) {
    const dayofWPartial = parseDayofWPartial(str);
    if (dayofWPartial) {
      const measure = "week";
      const base: ShowDate[] = dayofWPartial.cands.map(({ v }) => ({
        d: getDayofWInRange(v).first,
        dayofw: v,
        measure,
      }));
      if (base.length > 1) {
        parallel.push(...base);
      } else {
        const [{ d: first }] = base;
        for (let i = 1; i <= 2; i++) {
          base.push({ d: first.add({ weeks: i }), measure });
        }
        parallel.push(base);
      }
    } else {
      const amount = parseSoleAmount(str);
      if (amount) {
        const { v } = amount;
        const td = getDateConcrete();
        const cands: ShowDate[] = (["day", "week", "month"] as ("day" | "week" | "month")[]).map(
          (dur) => ({
            d: td.add({ [`${dur}s`]: v }),
            relative: { amount: v, dur },
          }),
        );
        parallel.push(cands);
      }
    }
  }

  const { year, months, day } = parseMaybeYMD(str) ?? {};

  if (months || year) {
    const mvs = months?.map(({ v }) => v) ?? [undefined];
    const base: ShowDate[] = mvs.map((v) => ({
      d: getDateConcrete(year?.v, v, day?.v),
    }));
    if (base.length > 1) parallel.push(...base);
    else {
      const [{ d: first }] = base;
      for (let i = 1; i <= 2; i++) base.push({ d: first.add({ years: i }) });
      parallel.push(base);
    }
  } else if (day) {
    const start = getDateConcrete(undefined, undefined, day.v);
    const cands: ShowDate[] = [{ d: start }];
    for (let i = 1; i <= 2; i++) {
      cands.push({ d: start.add({ months: i }) });
    }
    parallel.push(cands);
  }

  return parallel;
}
