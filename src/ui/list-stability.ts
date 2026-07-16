import type { TodoViewItem } from "./todos.tsx";

export function preserveReferencedList<T>(previous: T[] | undefined, next: T[]): T[] {
  return previous !== undefined
    && previous.length === next.length
    && previous.every((item, index) => item === next[index])
    ? previous
    : next;
}

export function preserveEquivalentTodos(previous: TodoViewItem[] | undefined, next: TodoViewItem[]): TodoViewItem[] {
  return previous !== undefined
    && previous.length === next.length
    && previous.every((todo, index) => {
      const candidate = next[index];
      return candidate !== undefined
        && todo.id === candidate.id
        && todo.text === candidate.text
        && todo.status === candidate.status
        && todo.done === candidate.done
        && todo.activeForm === candidate.activeForm;
    })
    ? previous
    : next;
}
