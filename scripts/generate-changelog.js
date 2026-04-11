#!/usr/bin/env node
/**
 * Auto-generate changelog from git commit messages between two tags.
 * Usage: node scripts/generate-changelog.js [from-tag] [to-tag]
 * If no tags given, generates from last tag to HEAD.
 */

const { execSync } = require('child_process')

const args = process.argv.slice(2)
let range

if (args.length >= 2) {
  range = `${args[0]}..${args[1]}`
} else {
  // Find the last two tags
  const tags = execSync('git tag --sort=-creatordate').toString().trim().split('\n').filter(Boolean)
  if (tags.length === 0) {
    console.log('No tags found.')
    process.exit(0)
  }
  range = tags.length >= 2 ? `${tags[1]}..${tags[0]}` : tags[0]
}

const log = execSync(`git log ${range} --oneline --no-merges`).toString().trim()
if (!log) {
  console.log('No commits in range.')
  process.exit(0)
}

const lines = log.split('\n')

const categories = {
  feat: { label: '✨ Features', items: [] },
  fix: { label: '🐛 Bug Fixes', items: [] },
  refactor: { label: '♻️ Refactoring', items: [] },
  docs: { label: '📝 Documentation', items: [] },
  chore: { label: '🔧 Chores', items: [] },
  other: { label: '📋 Other', items: [] }
}

for (const line of lines) {
  const match = line.match(/^[a-f0-9]+ (feat|fix|refactor|docs|chore|ci|build|test)(?:\(.*?\))?:\s*(.+)/)
  if (match) {
    const type = match[1]
    const msg = match[2]
    const cat = categories[type] || categories.other
    cat.items.push(msg)
  } else {
    const msg = line.replace(/^[a-f0-9]+ /, '')
    categories.other.items.push(msg)
  }
}

let output = `## Changelog\n\n`
for (const cat of Object.values(categories)) {
  if (cat.items.length > 0) {
    output += `### ${cat.label}\n`
    for (const item of cat.items) {
      output += `- ${item}\n`
    }
    output += '\n'
  }
}

console.log(output)
