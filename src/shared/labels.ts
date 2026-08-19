/**
 * Rules that follow from the labels on an entry, shared by the server and the client so the
 * two never disagree about what an entry is entitled to.
 */

/**
 * A sentence is already an example of itself, so it gets none of its own: asking for three
 * more only produces variations on the same sentence. Both label sets count — the AI assigns
 * "sentence" itself, and the user may have labelled it that way too.
 */
export function takesExamples(word: { categories?: string[]; aiCategories?: string[] }): boolean {
  return ![...(word.categories ?? []), ...(word.aiCategories ?? [])].includes('sentence');
}
