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

// Auth wiring set by +page.svelte; consumed by UserPanel (via OperationPage).
// `onAuthChange` fires on sign-in/out so the page can pull data and swap
// demo state. `opts.newUser` is set on the very sign-up that minted this
// account — the SPA preserves the current demo state and uploads it instead
// of pulling (empty) server state.
export type AuthHooks = {
  onAuthChange?: (userId: string | null, opts?: { newUser?: boolean }) => void;
};
const [getAuthHooksRaw, setAuthHooksContext] = _createContext<AuthHooks>();
export const getAuthHooks = (): AuthHooks | null => {
  try {
    return getAuthHooksRaw();
  } catch {
    return null;
  }
};
export { setAuthHooksContext };

// Sync wiring set by +page.svelte; consumed by NavBar's refresh button.
// `refresh` pushes pending ops, pulls fresh state, and re-applies it to
// appState — defined in the page because only it has the state handle.
export type SyncHooks = {
  refresh: () => Promise<void>;
};
const [getSyncHooksRaw, setSyncHooksContext] = _createContext<SyncHooks>();
export const getSyncHooks = (): SyncHooks | null => {
  try {
    return getSyncHooksRaw();
  } catch {
    return null;
  }
};
export { setSyncHooksContext };

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
