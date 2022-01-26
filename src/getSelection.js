import { Kind } from 'graphql'

export default function getSelection({ node, selection, fragments }) {
  if (node.kind === Kind.FRAGMENT_SPREAD) {
    const fragment = fragments && fragments[node.name.value]
    return fragment
      ? getSelection({ node: fragment, selection, fragments })
      : null
  }
  const { selectionSet } = node
  if (!selectionSet) return null
  for (const s of selectionSet.selections) {
    if (s.kind === Kind.FRAGMENT_SPREAD || s.kind === Kind.INLINE_FRAGMENT) {
      const found = getSelection({ node: s, selection, fragments })
      if (found) return found
    } else {
      const [name, ...rest] = selection
      if (s.name && s.name.value === name) {
        if (!rest.length) return s
        const found = getSelection({ node: s, selection: rest, fragments })
        if (found) return found
      }
    }
  }
}
