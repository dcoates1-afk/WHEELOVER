/**
 * The commit the running bundle was built from.
 *
 * Vite substitutes the identifier at build time (see `define` in
 * vite.config.ts), so this names the code actually executing in the tab rather
 * than whatever the server happens to be serving now. That distinction is the
 * whole point: a shell cached from an earlier deploy runs old JavaScript while
 * every request it makes reaches the new server, and only the running code can
 * notice the gap.
 */
declare const __BUILD_COMMIT__: string;

const stamped = typeof __BUILD_COMMIT__ === 'string' ? __BUILD_COMMIT__.trim() : '';

/** Empty when the build carried no stamp (development, or a build without git). */
export const RUNNING_COMMIT = stamped;
