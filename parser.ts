import fs from 'fs/promises'

export const Status = {
  todo: 'todo',
  inprogress: 'inprogress',
  done: 'done'
} as const
export type Status = keyof typeof Status
export const statusMap: {[str: string]: Status} = {
  'x': Status.done,
  '~': Status.inprogress,
  ' ': Status.todo
} as const

export type Todo = {
  status: Status
  title: string
  scope: number,
  parent?: Todo
  label?: string
}

const todoParserRegex = /(\s*)\[([ xX~])\](.+)$/
const parseLine = (line: string) => {
  const parseResult = todoParserRegex.exec(line) as null | string[]
  if (!parseResult) return null
  const [_, whitespaces, statusString, name] = parseResult
  const trimmedName = name.trim()
  const status = statusMap[statusString.toLocaleLowerCase()]
  const scope = whitespaces.length
  if (status && trimmedName) {
    const todo = { status, title: trimmedName, scope: whitespaces.length } as Todo
    return todo
  }
  return null
}

export const findTodoList = async (filepath: string) => {
  const data = await fs.readFile(filepath, { encoding: 'utf-8' }) as string
  const todos: Todo[] = []
  const lines = data.split('\n')
  for (let line of lines) {
    const todo = parseLine(line)
    if (todo) {
      // We reverse the array so we find the closes todo that has a scope less than the current one
      const reversed = todos.reverse()
      const parent = reversed.find(old => old.scope < todo.scope)
      if (parent) todo.parent = parent
      todos.reverse()
      todos.push(todo)
    }
  }
  return todos
}