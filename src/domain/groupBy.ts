export function groupBy<T, Key>(items: T[], keyFor: (item: T) => Key) {
  const groups = new Map<Key, T[]>()
  for (const item of items) {
    const key = keyFor(item)
    const group = groups.get(key)
    if (group) group.push(item)
    else groups.set(key, [item])
  }
  return groups
}
