export type UserTask = { text: string; group?: string; isDone: boolean }
export type TaskList = { title: string; tasks: UserTask[] }

declare module 'claude-code' {
  interface PluginState {
    'todo-panel': {
      panel: { list: TaskList | null; revision: number; scanId: number; isExpanded: boolean; isHidden: boolean }
      // Read only to migrate sessions that reload from the previous plugin version.
      list: TaskList | null
      isExpanded: boolean
      isHidden: boolean
    }
  }
}
