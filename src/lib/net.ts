export const NO_SIGNAL = 'No signal. Check your connection and try again.';

/** True when a request failed because the phone could not reach the server. */
export function isNetworkError(message: string) {
  return (typeof navigator !== 'undefined' && navigator.onLine === false)
    || /failed to fetch|networkerror|load failed|network request failed|fetch failed|no signal/i.test(message);
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
