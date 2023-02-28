import fetchPonyfill from 'fetch-ponyfill'
import { Status, Todo } from './parser'
import qs from 'node:querystring'
import * as dotenv from 'dotenv'
import prompts from 'prompts'

const { fetch } = fetchPonyfill()
dotenv.config()

let { TRELLO_API_KEY } = process.env
let { TRELLO_API_TOKEN } = process.env
let { TRELLO_BOARD_ID } = process.env
let { LABEL_FIRST_LAYER } = process.env
const { TODO_SEPARATOR = '-' } = process.env

type TrelloLabel = {
  id: string,
  idBoard: string,
  name: string,
  color: string
}

type TrelloList = {
  id: string,
  name: string,
  closed: boolean,
  idBoard: string,
  pos: number,
  subscribed: boolean,
}

type TrelloCard = {
  id: string,
  badges: any,
  checkItemStates: null,
  closed: boolean,
  dueComplete: boolean,
  dateLastActivity: string,
  desc: string,
  descData: { emoji: {} },
  due: null,
  dueReminder: null,
  email: null,
  idBoard: string,
  idChecklists: Array<any>,
  idList: string,
  idMembers: Array<any>,
  idMembersVoted: Array<any>,
  idShort: 1,
  idAttachmentCover: null,
  labels: Array<TrelloLabel>,
  idLabels: Array<string>,
  manualCoverAttachment: boolean,
  name: string,
  pos: number,
  shortLink: string,
  shortUrl: string,
  start: null,
  subscribed: boolean,
  url: string,
  cover: any,
  isTemplate: boolean,
  cardRole: null
}


const getWholeTitleFromTodo = (todo: Todo): string[] => {
  if (!todo.parent) return [todo.title]
  return [...getWholeTitleFromTodo(todo.parent), todo.title]
}

const processTodos = (_todos: Todo[]): {labels: Set<Todo>, todos: Set<Todo>} => {
  const labels = LABEL_FIRST_LAYER ? new Set(_todos.filter(todo => !todo.parent)) : new Set<Todo>()
  const todos = new Set(_todos.filter(todo => !labels.has(todo)))
  for (let todo of todos) {
    const totalNames = getWholeTitleFromTodo(todo)
    const nameChunks = totalNames.slice(LABEL_FIRST_LAYER ? 1 : 0)
    todo.title = nameChunks.join(` ${TODO_SEPARATOR} `)
    todo.label = totalNames[0]
  }
  return { labels, todos }
}


type QueryObject = {[key: string]: string}
const queryString = (query: any) => {
  return qs.encode(query)
}


const authQuery = { key: TRELLO_API_KEY || '', token: TRELLO_API_TOKEN || '' }
const boardEndpoint = (root: string, query: QueryObject = authQuery, ...resources: string[]) => `https://api.trello.com/1/${root}/${TRELLO_BOARD_ID}/${resources.join('/')}?${queryString(query)}`
const rootEndpoint = (root: string, query: QueryObject = authQuery, ...resources: string[]) => `https://api.trello.com/1/${root}/${resources.join('/')}?${queryString(query)}`
const mainBoardEndpoint = (query: QueryObject = authQuery, ...resources: string[]) => boardEndpoint('board', query, ...resources)
const listsEndpoint = (query: QueryObject = authQuery) => boardEndpoint('board', query, 'lists')
const cardsEndpoint = (query: QueryObject = authQuery) => boardEndpoint('board', query, 'cards')
const cardEndpoint = (cardId: string, query: QueryObject = authQuery) => rootEndpoint('cards', query, cardId)
const cardLabelEndpoint = (cardId: string, query: QueryObject = authQuery) => rootEndpoint('cards', query, cardId, 'idLabels')

const fetchLists = async () => {
  const req = await fetch(listsEndpoint())
  const json = await req.json()
  return json as TrelloList[]
}

type StatusMap = {[key in Status]: TrelloList}
const categorizeLists = (lists: TrelloList[]): StatusMap => {
  const TodoRegex = /To\W*Do\W*/i
  const InProgressRegex = /In(:?\W|_)*Progress\W*/i
  const DoneRegex = /d+o+n+e+/i

  const todoList = lists.find(list => list.name.match(TodoRegex))
  const inProgressList = lists.find(list => list.name.match(InProgressRegex))
  const doneList = lists.find(list => list.name.match(DoneRegex))
  if (!todoList || !inProgressList || !doneList) {
    throw new Error(`Could not find list for status ${[!todoList && Status.todo, !inProgressList && Status.inprogress, !doneList && Status.done].filter(Boolean)[0]}`)
  }
  return {
    [Status.done]: doneList,
    [Status.inprogress]: inProgressList,
    [Status.todo]: todoList,
  }
}

const fetchCards = async () => {
  const req = await fetch(cardsEndpoint())
  const json = await req.json()
  return json as TrelloCard[]
}

const getBoardSettings = async () => {
  const req = await fetch(mainBoardEndpoint())
  const json = await req.json()
  return json
}

const wait = (duration: number) => new Promise((res, rej) => {
  setTimeout(res, duration)
})
const getLabels = async () => {
  const req = await fetch(mainBoardEndpoint(authQuery, 'labels'))
  const json = await req.json() as TrelloLabel[]
  return json
}

export const syncLabels = async (labels: Set<Todo>, labelNames: string[]) => {
  if (labels.size <= 0) return []
  const currentTrelloLabels = new Map<string, TrelloLabel>((await getLabels()).filter(label => label.name).map(label => [label.name, label]))
  const todosToSyncToLabels = [...labels].filter(label => !currentTrelloLabels.has(label.title))
  const labelsToSyncToTodoList = [...labels].filter(label => currentTrelloLabels.has(label.title))
  const promises = todosToSyncToLabels.map((label, i) => createLabel(label.title, labelNames[i % labelNames.length]))
  const newLabels = await Promise.all(promises)
  const allLabels = [...newLabels, ...currentTrelloLabels.values()]
  return [allLabels, labelsToSyncToTodoList] as [TrelloLabel[], Todo[]]
}

export const createLabel = async (name: string, color: string) => {
  const req = await fetch(mainBoardEndpoint({ ...{ name, color } , ...authQuery}, 'labels'), {
    method: 'post'
  })
  const json = await req.json()
  return json as TrelloLabel
}

export const diffTodos = async (todos: Set<Todo>, labels: Set<Todo>, cards: TrelloCard[], statusMap: StatusMap) => {
  const todosToUpload = new Set<Todo>()
  const sameTodos = new Set<[Todo, TrelloCard]>()
  const todosToUpdateLists = new Set<[Todo, TrelloCard]>
  const todosToUpdateLabels = new Set<[Todo, TrelloCard]>
  const ret = {todosToUpload, todosToUpdateLabels, todosToUpdateLists}
  if (todos.size <= 0) return ret

  for (const todo of todos) {
    const found = cards.find((card) => todo.title === card.name)
    if (found) sameTodos.add([todo, found])
    else todosToUpload.add(todo)
  }

 
  for (const todoPair of sameTodos) {
    const [todo, trello] = todoPair
    const correctList = statusMap[todo.status]
    if (trello.idList !== correctList.id) {
      todosToUpdateLists.add(todoPair)
    }
  }

  for (const todoPair of sameTodos) {
    const [todo, trello] = todoPair
    const todoLabel = todo.label
    if (todoLabel) {
      const hasTitle = trello.labels.some(label => label.name === todoLabel)
      if (!hasTitle) todosToUpdateLabels.add(todoPair)
    }
  }
  return ret
}

const updateList = async (todo: Todo, card: TrelloCard, statusMap: StatusMap) => {
  const correctList = statusMap[todo.status]
  return await (await fetch(cardEndpoint(card.id, { ...authQuery, idList: correctList.id}), {
    method: 'PUT'
  })).json()
}

const updateLabel = async (todo: Todo, card: TrelloCard, labelMap: Map<string, string>) => {
  if (!todo.label || !labelMap.get(todo.label)) throw new Error(`Could not find valid label to apply to todo "${todo.title}"`)
  const correctLabel = labelMap.get(todo.label) as string
  return await (await fetch(cardLabelEndpoint(card.id, { ...authQuery, value: correctLabel }), {
    method: 'POST'
  })).json()
}

const createCard = async (todo: Todo, labelMap: Map<string, string>, statusMap: StatusMap) => {
  await wait(10 + (Math.random() * 9900) | 0)
  const correctLabel = labelMap.get(todo.label as string)
  const correctList = statusMap[todo.status]
  return await (await fetch(cardEndpoint('', { ...authQuery, name: todo.title, idList: correctList.id,  ...(correctLabel ? {idLabels: correctLabel} : {}), }), {
    method: 'POST'
  })).json()
}

export const updateLists = async (todosToUpdateLists: Set<[Todo, TrelloCard]>, statusMap: StatusMap) => {
  return await Promise.all([...todosToUpdateLists].map(([todo, card]) => updateList(todo, card, statusMap)))
}

export const updateLabels = async (todosToUpdateLabels: Set<[Todo, TrelloCard]>, labelMap: Map<string, string>) => {
  return await Promise.all([...todosToUpdateLabels].map(([todo, card]) => updateLabel(todo, card, labelMap)))
}

export const createCards = async (todosToAdd: Set<Todo>, labelMap: Map<string, string>, statusMap: StatusMap) => {
  return await Promise.all([...todosToAdd].map(todo => createCard(todo, labelMap, statusMap)))
}

const categorizeLabels = (currentTrelloLabels: TrelloLabel[]) => {
  return new Map(currentTrelloLabels.map(e => [e.name, e.id]))
}

export const sync = async (_todos: Todo[]) => {
  if (!TRELLO_API_KEY) {
    const { value } = await prompts({
      name: 'value',
      type: 'text',
      message: 'What is your Trello API Key?'
    })
    TRELLO_API_KEY = value
  }

  if (!TRELLO_API_TOKEN) {
    const { value } = await prompts({
      name: 'value',
      type: 'text',
      message: 'What is your Trello API Token?'
    })
    TRELLO_API_TOKEN = value
  }

  if (!TRELLO_BOARD_ID) {
    const { value } = await prompts({
      name: 'value',
      type: 'text',
      message: 'What is your Trello Board ID?'
    })
    TRELLO_BOARD_ID = value
  }

  const settings = await getBoardSettings()
  
  const labelNames = Object.keys(settings?.labelNames || {})

  const { labels, todos } = processTodos(_todos)
  try {
    const [currentTrelloLabels] = await syncLabels(labels, labelNames)
    const labelMap = categorizeLabels(currentTrelloLabels)
    const lists = await fetchLists()
    const statusMap = categorizeLists(lists)
    const inverseStatusMap = new Map(Object.entries(statusMap).map(([status, card]) => [card.id, status]))
    const cards = await fetchCards()
    const wipTodos = await diffTodos(todos, labels, cards, statusMap)
    if (wipTodos.todosToUpdateLists.size > 0) {
      console.log('Statuses to update')
      wipTodos.todosToUpdateLists.forEach(([todo, card]) => {
        console.log(`${todo.title} ${inverseStatusMap.get(card.idList) || 'Unknown'} -> ${todo.status}`)
      })
      const { value } = await prompts({
        type: 'confirm',
        name: 'value',
        message: 'Are you sure you want to change these status',
        initial: true
      })
      if (value) {
        console.log('Updating lists')
        await updateLists(wipTodos.todosToUpdateLists, statusMap)
      }
    }

    if (wipTodos.todosToUpdateLabels.size > 0) {
      console.log('Cards to update labels')
      wipTodos.todosToUpdateLabels.forEach(([todo, card]) => {
        console.log(`"${todo.title}" ${JSON.stringify(card.labels.map(e => e.name))}-> ${JSON.stringify(card.labels.concat({name: todo.label || 'Empty Label'} as unknown as TrelloLabel).map(e => e.name))}`)
      })
      const { value } = await prompts({
        type: 'confirm',
        name: 'value',
        message: 'Are you sure you want to change these labels',
        initial: true
      })
      if (value) {
        console.log('Updating labels')
        const result = await updateLabels(wipTodos.todosToUpdateLabels, labelMap)
        console.log(result)
      }
    }

    if (wipTodos.todosToUpload.size > 0) {
      console.log('New Cards to add')
      wipTodos.todosToUpload.forEach((todo) => {
        console.log(`"${todo.title}" ${todo.label ? `[${todo.label}]` : ''}`)
      })
      const { value } = await prompts({
        type: 'confirm',
        name: 'value',
        message: 'Are you sure you want to add these cards',
        initial: true
      })
      if (value) {
        console.log('Updating cards')
        const results = await createCards(wipTodos.todosToUpload, labelMap, statusMap)
        console.log(results)
        const errors = results.map((res, i) => [res, [...wipTodos.todosToUpload][i]] as [any, Todo]).filter(([res]) => res.error)
        errors.forEach(([result, todo]) => {
          console.error(`Error creating card "${todo.title}": ${JSON.stringify(result)}`)
        })
      }
    }
  } catch(e) {
    console.log(e)
  }
}