import type { CalendarDate } from "@internationalized/date";

export type ReadonlyDeep<T> = T extends Function
  ? T
  : T extends Date | CalendarDate
    ? T
    : T extends readonly (infer U)[]
      ? readonly ReadonlyDeep<U>[]
      : T extends object
        ? { readonly [K in keyof T]: ReadonlyDeep<T[K]> }
        : T;

export type MergeTwoNoOverlap<A, B> = Extract<keyof A, keyof B> extends never ? A & B : never;

export type MergeNoOverlap<T extends readonly Record<string, any>[]> = T extends readonly [
  infer A,
  infer B,
  ...infer Rest,
]
  ? A extends Record<string, any>
    ? B extends Record<string, any>
      ? Rest extends readonly Record<string, any>[]
        ? MergeNoOverlap<[MergeTwoNoOverlap<A, B>, ...Rest]>
        : MergeTwoNoOverlap<A, B>
      : never
    : never
  : T extends readonly [infer A]
    ? A extends Record<string, any>
      ? A
      : never
    : {};
