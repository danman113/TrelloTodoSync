#! /usr/bin/env node
import { findTodoList } from "./parser"
import glob from 'glob'
import { sync } from "./sync"

/**
 * [x] Get a glob of all the files
 * [x] Parse a todo list 
 */

const asyncGlob = (search: string) => {
  return new Promise<string[]>((resolve, reject) => {
    glob(search, async (err, matches) => {
      if (err) reject(err)
      else resolve(matches)
    })
  })
}

const main = async () => {
  const search = process.argv.splice(2)
  const globResults = await Promise.all(search.map(glb => asyncGlob(glb)))
  const files = globResults.flat()
  const data = await Promise.all(files.map(filepath => findTodoList(filepath)))
  await sync(data.flat())
}

main()
