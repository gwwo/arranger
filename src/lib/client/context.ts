import { createContext as _createContext } from "svelte";

function createContext<T>(defaultError?: string): [(errorMessage?: string) => T, (value: T) => T] {
  const [get, set] = _createContext<T>();
  const getWithError = (errorMessage?: string) => {
    try {
      return get();
    } catch {
      throw new Error(errorMessage ?? defaultError);
    }
  };
  return [getWithError, set];
}
import { type AppState, type PanelItem, type ProjectItem, type TodoItem } from "./model";

export type PanelContext = { panelId: string };
export type ProjContext = { projId: string };
export type TodoContext = { rowId: string };

export const [getPanelContext, setPanelContext] = createContext<PanelContext>("getPanelContext called outside a panel");
export const [getProjContext, setProjContext] = createContext<ProjContext>("getProjContext called outside a project");
export const [getTodoContext, setTodoContext] = createContext<TodoContext>("getTodoContext called outside a todo row");

export const [getAppState, setAppStateContext] = createContext<AppState>("getAppState called before app state was set");

export const createMutator = <Ctx, Args extends any[], R>(
  getCtx: () => Ctx,
  fn: (state: AppState, ctx: Ctx, ...args: Args) => R,
) => {
  const hook = () => {
    const state = getAppState();
    const ctx = getCtx();
    return (...args: Args) => fn(state, ctx, ...args);
  };
  hook.pure = fn;
  hook.dynamic = () => {
    const state = getAppState();
    return (ctx: Ctx, ...args: Args) => fn(state, ctx, ...args);
  };
  return hook;
};
