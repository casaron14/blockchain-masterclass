// The `googleapis` package entry point constructs every Google API client. Its
// runtime code is over 200 MB, which is larger than a serverless function may
// bundle. The Gmail subpackage exposes the same `gmail(...)` factory and `auth`
// helper while loading only the Gmail v1 surface.
export async function loadGmailApiModule() {
  return import('googleapis/build/src/apis/gmail/index.js');
}
