// The API names every CSV download in a Content-Disposition header. The
// browser cannot read that header from a plain link (the request needs the
// admin bearer token), so the file is fetched and the name is parsed here.
const CONTENT_DISPOSITION_FILENAME_PATTERN = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i;

export function resolveCsvDownloadFileName(
  contentDispositionHeader,
  fallbackFileName
) {
  const matchedFileName = CONTENT_DISPOSITION_FILENAME_PATTERN.exec(
    String(contentDispositionHeader || '')
  );

  if (!matchedFileName) {
    return fallbackFileName;
  }

  try {
    const decodedFileName = decodeURIComponent(matchedFileName[1].trim());
    return decodedFileName || fallbackFileName;
  } catch {
    // A malformed percent escape must not break the download; the server
    // supplied a fallback name for exactly this case.
    return fallbackFileName;
  }
}
