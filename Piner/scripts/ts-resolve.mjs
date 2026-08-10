/**
 * Resolver hook for `node --test`: lets node's built-in TypeScript stripping follow the
 * extensionless relative imports the Vite build uses (`./foo` -> `./foo.ts`).
 *
 * This exists only so the strategy engine can be tested without adding a test framework or a
 * bundler step; the app itself is unaffected.
 */
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    for (const candidate of [`${specifier}.ts`, `${specifier}.tsx`, `${specifier}/index.ts`]) {
      try {
        return await next(candidate, context);
      } catch {
        // try the next candidate
      }
    }
  }
  return next(specifier, context);
}
