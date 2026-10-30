// Loaded as a classic script before the app bundle: Zod reads this global when it loads and
// decides then whether to compile schemas with `new Function`. The CSP forbids eval, so that
// probe would be reported as a violation on every page load.
globalThis.__zod_globalConfig = { jitless: true };
