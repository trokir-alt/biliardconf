/** Resolves '@netlify/blobs' to the local fake; see scripts/blobs-fake.mjs. */
import { pathToFileURL } from 'node:url'

const FAKE = pathToFileURL(new URL('./blobs-fake.mjs', import.meta.url).pathname).href

export async function resolve(specifier, context, next) {
  if (specifier === '@netlify/blobs') return { url: FAKE, shortCircuit: true }
  return next(specifier, context)
}
