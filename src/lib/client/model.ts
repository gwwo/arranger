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

const newId = () => crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

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

export type OperationInstance = "inbox" | "planned" | "archive" | "trash" | "search";

export type Instance = ProjectInstance | OperationInstance;

export const isProjectInstance = (inst: Instance): inst is ProjectInstance => {
  return typeof inst === "object" && inst !== null;
};

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

export const newPanelItem = (data: {
  layout?: Partial<PanelLayout>;
  instance: ProjectInstance | OperationInstance;
}): PanelItem => {
  const { layout, instance } = data;
  const { mainWidth, height, sideWidth, spacerLeft, sideShow } = layout ?? {};
  return {
    id: newId(),
    layout: {
      mainWidth: mainWidth ?? 400,
      height: height ?? 650,
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
  project: { name: "New Project", note: "Notes" },
  todo: { title: "New To-Do", note: "Notes" },
  grouping: { label: "New Heading" },
};


export type AppState = {
  panels: PanelItem[],
  projects: ProjectItem[]
}