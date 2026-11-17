/** An error shaped like the googleapis client's: `asGmailApiError` reads its `code`. */
export function apiError(code: number, message: string): Error {
  return Object.assign(new Error(message), { code });
}
