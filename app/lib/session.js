// Promise wrappers for the session callbacks.
//
// Sign-in has to regenerate the identifier and flush the new state before the
// redirect is written, otherwise the next request arrives with a cookie whose
// row is not there yet. Awaiting the callbacks is the only way to guarantee
// that ordering, and both participant and archivist sign-in need it.

export const regenerateSession = (session) =>
  new Promise((resolve, reject) => session.regenerate((error) => (error ? reject(error) : resolve())));

export const saveSession = (session) =>
  new Promise((resolve, reject) => session.save((error) => (error ? reject(error) : resolve())));

export const destroySession = (session) =>
  new Promise((resolve, reject) => session.destroy((error) => (error ? reject(error) : resolve())));
