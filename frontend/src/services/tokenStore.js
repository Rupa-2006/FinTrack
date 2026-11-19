// The access token lives in this module's memory only: never in localStorage, sessionStorage
// or a readable cookie, so a script injected into the page cannot lift it from storage.
// It is lost on a full reload by design; the session is then restored through the httpOnly
// refresh cookie, which JavaScript cannot read at all.
let accessToken = null;

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token) {
  accessToken = token || null;
}

export function clearAccessToken() {
  accessToken = null;
}
