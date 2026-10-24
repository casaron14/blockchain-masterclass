// CSV downloads are produced by the API and saved by the browser, so the
// response carries both the media type and the file name. Keeping the header
// work in one place is what stops an export endpoint from accidentally
// returning the CSV body as JSON.
export function sendCsvFileDownloadResponse(
  response,
  csvDocument,
  downloadFileName
) {
  response.setHeader('Content-Type', 'text/csv; charset=utf-8');
  response.setHeader(
    'Content-Disposition',
    `attachment; filename="${downloadFileName}"`
  );
  response.setHeader('Cache-Control', 'no-store');
  return response.status(200).send(csvDocument);
}
