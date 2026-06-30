import { CalendarDate } from "@internationalized/date";
import type { ReadonlyDeep } from "../utils/type-gymnastics";

type Item = { id: string };

export type CheckItem = Item & {
  ticked: boolean;
  text: string;
};

export type TodoStatus = "complete" | "todo";

export type TodoItem = Item & {
  title: string;
  note: string;
  checks: CheckItem[];
  status: TodoStatus;
  planned: CalendarDate | null;
};

export type GroupingItem = Item & {
  label: string;
};

export type RowItem = GroupingItem | TodoItem;

export const isGroupingItem = (item: RowItem): item is GroupingItem => {
  return "label" in item;
};

export const isTodoItem = (item: RowItem): item is TodoItem => {
  return "title" in item && "status" in item;
};

export type ProjectItem = Item & {
  name: string;
  note: string;
  rows: RowItem[];
};

type Raw<T> = Omit<T, "id">;

export type TodoInitData = Partial<Raw<TodoItem>>;

export type GroupingInitData = Partial<Raw<GroupingItem>>;

export type CheckInitData = Partial<Raw<CheckItem>>;

export type ProjectInitData = Partial<Raw<ProjectItem>>;

const newId = () => crypto.randomUUID();

export const newTodoItem = (data: TodoInitData = {}): TodoItem => {
  const { title, note, checks, status, planned } = data;
  return {
    id: newId(),
    title: title ?? "",
    note: note ?? "",
    checks: checks ?? [],
    status: status ?? "todo",
    planned: planned ?? null,
  };
};

export const newGroupingItem = (data: GroupingInitData = {}): GroupingItem => ({
  id: newId(),
  label: data.label ?? "",
});

export const newCheckItem = (data: CheckInitData = {}): CheckItem => ({
  id: newId(),
  ticked: data.ticked ?? false,
  text: data.text ?? "",
});

export const newProjectItem = (data: ProjectInitData = {}): ProjectItem => ({
  id: newId(),
  name: data.name ?? "",
  note: data.note ?? "",
  rows: data.rows ?? [],
});

export type PanelLayout = {
  mainWidth: number;
  height: number;
  sideShow: boolean;
  sideWidth: number | "disabled";
  spacerLeft: number | "disabled";
};

export type ProjectInstance = {
  // must reassign the whole instance to change project
  readonly project: ProjectItem;
  rowSelected: Record<string, boolean | undefined>;
  todoExpanded: Record<string, boolean | undefined>;
};

type InstanceInitData = { project: ProjectItem } & Partial<ProjectInstance>;

// Placement views (inbox/archive/trash) carry per-panel row UI state, just like
// a ProjectInstance — selecting/expanding in one panel must not bleed into
// another panel showing the same placement, and the state dies with the
// instance when the panel switches away or closes.
export type PlacementName = "inbox" | "archive" | "trash";

// Operations with no per-row UI state; stored on a panel as bare strings.
export type SimpleOperation = "planned" | "search" | "account";

// The string identifier for a view a panel can show (used by the navbar /
// switcher / sidebar menus). Distinct from the panel's stored instance, which
// is an object for projects and placements.
export type OperationInstance = PlacementName | SimpleOperation;

export type PlacementInstance = {
  readonly kind: PlacementName;
  selected: Set<string>;
  expandedId: string | null;
};

export type Instance = ProjectInstance | PlacementInstance | SimpleOperation;

export const isProjectInstance = (inst: Instance): inst is ProjectInstance => {
  return typeof inst === "object" && inst !== null && "project" in inst;
};

export const isPlacementInstance = (inst: Instance): inst is PlacementInstance => {
  return typeof inst === "object" && inst !== null && "kind" in inst;
};

const placementNames = new Set<OperationInstance>(["inbox", "archive", "trash"]);

export const isPlacementName = (op: OperationInstance): op is PlacementName =>
  placementNames.has(op);

// The view-selector string for a panel instance: a placement/simple-operation
// name, or null for a project instance.
export const operationOf = (inst: Instance): OperationInstance | null => {
  if (isProjectInstance(inst)) return null;
  return isPlacementInstance(inst) ? inst.kind : inst;
};

// Turn a menu selection (OperationInstance string) into a panel instance:
// placements become fresh objects with their own UI state, simple operations
// stay as strings.
export const operationToInstance = (op: OperationInstance): PlacementInstance | SimpleOperation =>
  isPlacementName(op) ? newPlacementInstance(op) : op;

export type PanelItem = Item & {
  layout: PanelLayout;
  instance: Instance;
};

export const newProjectInstance = (data: InstanceInitData): ProjectInstance => {
  const { project, rowSelected, todoExpanded } = data;
  return {
    project, // will keep project's identity
    rowSelected: rowSelected ?? {},
    todoExpanded: todoExpanded ?? {},
  };
};

export const newPlacementInstance = (
  kind: PlacementName,
  selected: Set<string> = new Set(),
  expandedId: string | null = null,
): PlacementInstance => ({ kind, selected, expandedId });

export const newPanelItem = (data: {
  id?: string;
  layout?: Partial<PanelLayout>;
  instance: Instance;
}): PanelItem => {
  const { id, layout, instance } = data;
  const { mainWidth, height, sideWidth, spacerLeft, sideShow } = layout ?? {};
  return {
    id: id ?? newId(),
    layout: {
      mainWidth: mainWidth ?? 450,
      height: height ?? 680,
      sideShow: sideShow ?? false,
      sideWidth: sideWidth === undefined ? "disabled" : sideWidth,
      spacerLeft: spacerLeft === undefined ? 60 : spacerLeft,
    },
    instance,
  };
};

export const placeholder: Readonly<{
  project: Pick<ProjectItem, "name" | "note">;
  todo: Pick<TodoItem, "title" | "note">;
  grouping: Pick<GroupingItem, "label">;
}> = {
  project: { name: "Some Project", note: "Notes" },
  todo: { title: "New To-Do", note: "Notes" },
  grouping: { label: "New Heading" },
};


// ─── Placement view entry types ───────────────────────────────────────────────

export type ArchiveTodoEntry = {
  kind: "todo";
  id: string;
  title: string;
  note: string;
  done: boolean;
  planned: string | null;
  projId: string | null;
  checks?: CheckItem[];
};

export type ArchiveProjEntry = {
  kind: "proj";
  id: string;
  name: string;
};

export type ArchiveEntry = ArchiveTodoEntry | ArchiveProjEntry;

export type AppState = {
  panels: PanelItem[];
  projects: ProjectItem[];
  inbox: TodoItem[];
  archive: ArchiveEntry[];
  trash: ArchiveEntry[];
  // Projects opened for editing from a placement view (archive/trash), mapped to
  // the placement they came from. They live in `projects` (so the normal project
  // view / mutators work against them) but are excluded from the active project
  // list everywhere it surfaces (sidebar, switcher, project-list-order pushes)
  // and preserved across syncs.
  openProjPlacement: Map<string, "archive" | "trash">;
  // Signed out there is no server to hold a project's rows while it sits in a
  // placement view (archive/trash) — so this is the client-side stand-in: the
  // full content of each archived/trashed project, keyed by id. A project is
  // parked here when it leaves the active list (archive/trash) and pulled back
  // out when reopened or restored, so its rows survive the round trip with no
  // fetch. Empty when signed in, where the server is the backing store.
  stashedProjects: Map<string, ProjectItem>;
  // Lazy-load tracking. A project/placement is a "stub" when its list entry is
  // known (name/order) but its content (rows / entries) hasn't been fetched yet.
  // Only the scopes shown by the open panels are bootstrapped on the server; the
  // rest start stubbed and are fetched on demand when a panel first shows them.
  // Stub === true means "needs fetch"; absent/false means loaded.
  projStub: Record<string, boolean>;
  placementStub: Record<PlacementName, boolean>;
}