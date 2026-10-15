export type UserTask = { text: string; group?: string; isDone: boolean }
export type TaskList = { title: string; tasks: UserTask[] }

declare module 'claude-code' {
  interface PluginState {
    'todo-panel': { list: TaskList | null; isExpanded: boolean; isHidden: boolean }
  }
}
