import {
  startOfMonth,
  startOfWeek,
  endOfMonth,
  getDayOfWeek,
  CalendarDate,
  today,
  getLocalTimeZone,
  type DayOfWeek,
} from "@internationalized/date";

const listMonthsInYear = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export const getToday = () => today(getLocalTimeZone());

export const getMonthName = (index: number) => listMonthsInYear[index - 1];

const weekLength = 7;
export const listDaysOfWeek: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const getDayOfW = (d: CalendarDate) =>
  listDaysOfWeek[getDayOfWeek(d, "", listDaysOfWeek[0])];

const locale = "en-AU";
// get the first day of week in locale
const firstDayOfWeek: DayOfWeek = getDayOfW(startOfWeek(getToday(), locale));

type Month = { month: number; year: number; days: number };

export const getDaysInMonth = (month: number, year: number): number => {
  const leapFeb = month === 2 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return leapFeb ? 29 : [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
};

export const getDaysInYear = (year: number) =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365;

const getPreMonth = (month: number, year: number): Month => {
  const m = month,
    y = year;
  return m === 1
    ? { month: 12, year: y - 1, days: 31 }
    : { month: m - 1, year: y, days: getDaysInMonth(m - 1, y) };
};

const getNextMonth = (month: number, year: number): Month => {
  const m = month,
    y = year;
  return m === 12
    ? { month: 1, year: y + 1, days: 31 }
    : { month: m + 1, year: y, days: getDaysInMonth(m + 1, y) };
};

type MonthGridPartial = ({ pre: Month; cur?: Month } | { pre?: Month; cur: Month }) & {
  daysPrecede: number;
  weekIndex: number;
  preWeekIndex?: number;
  nextWeekIndex?: number;
};

export type MonthGrid = {
  pre: Month;
  cur: Month;
  daysPrecede: number;
  weekIndex: number;
  preWeekIndex: number;
  nextWeekIndex: number;
};

const useMonthGridProvider = () => {
  const monthsCached = new Map<number, MonthGrid>();
  return (weekIndex: number, fallback: () => MonthGridPartial): MonthGrid => {
    let mg = monthsCached.get(weekIndex);
    if (mg !== undefined) return mg;
    let m = fallback();

    const pre = m.pre ?? getPreMonth(m.cur!.month, m.cur!.year);
    const cur = m.cur ?? getNextMonth(m.pre!.month, m.pre!.year);

    const preWeekIndex =
      m.preWeekIndex ?? m.weekIndex - Math.ceil((pre.days - m.daysPrecede) / weekLength);
    const nextWeekIndex =
      m.nextWeekIndex ?? m.weekIndex + Math.floor((cur.days + m.daysPrecede) / weekLength);
    const mComplete = { ...m, pre, cur, preWeekIndex, nextWeekIndex };
    monthsCached.set(m.weekIndex, mComplete);
    return mComplete;
  };
};

export const calComplement = (count: number, factor: number = 7) =>
  (factor - (count % factor)) % factor;

export const useCalendar = (dateMonthZero: CalendarDate, monthRadius: number = 100) => {
  // use the start date to represent a month
  const dateFirst = startOfMonth(dateMonthZero.add({ months: -monthRadius }));
  const daysPrecedeFirst = getDayOfWeek(dateFirst, "", firstDayOfWeek);
  const dateLast = endOfMonth(dateMonthZero.add({ months: monthRadius }));

  const getWeekIndexForDate = (d: CalendarDate) =>
    Math.floor((daysPrecedeFirst + d.compare(dateFirst)) / 7);

  // two monthStart will never reside in the same week

  const getMonthGrid = useMonthGridProvider();

  const getMonth = (index: number) => {
    const startMonth = dateFirst.add({ months: index + monthRadius });
    const { month, year } = startMonth;
    const daysCount = startMonth.compare(dateFirst);
    const weekIndex = Math.floor((daysPrecedeFirst + daysCount) / 7);
    return getMonthGrid(weekIndex, () => {
      const daysPrecede = (daysPrecedeFirst + daysCount) % 7;
      return {
        cur: { month, year, days: getDaysInMonth(month, year) },
        daysPrecede,
        weekIndex,
      };
    });
  };

  let monthArrCached: MonthGrid[] = [];

  const getMonthsToCover = (startWeekIndex: number, endWeekIndex: number) => {
    if (startWeekIndex > endWeekIndex) throw new Error("to cover an invalid week range");

    // console.log(startWeekIndex, endWeekIndex)

    let monthsReuse: MonthGrid[] = [];
    monthArrCached.some((m) => {
      if (m.weekIndex > endWeekIndex) return true; // outside bottom boundary
      if (
        monthsReuse.length > 0 ||
        m.nextWeekIndex > startWeekIndex // inside top boundary
      ) {
        monthsReuse.push(m);
      }
    });

    const topMonth = monthsReuse.at(0);
    const bottomMonth = monthsReuse.at(-1) ?? getMonthToCover(startWeekIndex);

    const fromBack = topMonth ? [...getMonthsBackward(topMonth, startWeekIndex)].reverse() : [];
    const fromReuse = topMonth ? monthsReuse : [bottomMonth];
    const fromForward = getMonthsForward(bottomMonth, endWeekIndex);

    // console.log(fromBack.map(mg => mg.weekIndex), fromReuse.map(mg => mg.weekIndex), [...fromForward].map(mg => mg.weekIndex))

    monthArrCached = [...fromBack, ...fromReuse, ...fromForward];

    return monthArrCached;
  };

  const getMonthsBackward = function* (mg: MonthGrid, startWeekIndex: number) {
    while (true) {
      if (mg.weekIndex <= startWeekIndex) return;
      const weekIndex = mg.preWeekIndex;

      // const { month, year } = mg.pre
      // if (getWeekIndexForMonth(month, year) != weekIndex) throw new Error("wrong backward");

      mg = getMonthGrid(weekIndex, () => {
        const daysPrecede = calComplement(mg.pre.days - mg.daysPrecede);
        return {
          cur: mg.pre,
          weekIndex,
          daysPrecede,
          nextWeekIndex: mg.weekIndex,
        };
      });
      yield mg;
    }
  };

  const getMonthsForward = function* (mg: MonthGrid, endWeekIndex: number) {
    while (true) {
      const weekIndex = mg.nextWeekIndex;
      if (weekIndex > endWeekIndex) return;

      // const { month, year } = getNextMonth(mg.cur.month, mg.cur.year)
      // const ground = getWeekIndexForMonth(month, year)
      // console.log(month, year, ground)
      // console.log('forward', mg.cur, mg.weekIndex, weekIndex)

      // const d = dateMonthZero.set({month: month, year: year, day: 1})
      // console.log(mg.daysPrecede, getDayOfWeek(d, locale, firstDayOfWeek))
      // console.log(daysPrecedeFirst)

      // if (ground != weekIndex) throw new Error("wrong forward");

      mg = getMonthGrid(weekIndex, () => {
        const daysPrecede = (mg.daysPrecede + mg.cur.days) % 7;
        return {
          pre: mg.cur,
          weekIndex,
          daysPrecede,
          preWeekIndex: mg.weekIndex,
        };
      });
      yield mg;
    }
  };

  const getMonthToCover = (weekIndex: number): MonthGrid => {
    const lastDateInTheWeek = dateFirst.add({
      days: weekIndex * 7 + (6 - daysPrecedeFirst),
    });
    const { month, year, day } = lastDateInTheWeek;
    // weekIndex = weekIndex - (Math.ceil(day / 7) - 1)
    weekIndex = weekIndex - Math.floor((day - 1) / 7);

    // if (getWeekIndexForMonth(month, year) != weekIndex) throw new Error("wrong month to cover");

    return getMonthGrid(weekIndex, () => {
      const daysPrecede = calComplement(day);
      return {
        cur: { month, year, days: getDaysInMonth(month, year) },
        weekIndex,
        daysPrecede,
      };
    });
  };

  return {
    getMonthsToCover,
    getMonth,
    getWeekIndexForDate,
    dateMonthZeroWeekIndex: getWeekIndexForDate(dateMonthZero),
    dateLastWeekIndex: getWeekIndexForDate(dateLast),
  };
};
