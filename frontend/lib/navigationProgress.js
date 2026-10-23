const INTERNAL_HTTP_PROTOCOLS = new Set(['http:', 'https:']);

export function shouldShowNavigationProgressForAnchor(anchorElement, currentPageUrl) {
  if (!anchorElement || !currentPageUrl) {
    return false;
  }

  const linkTarget = anchorElement.getAttribute?.('target') || '';
  if (linkTarget && linkTarget !== '_self') {
    return false;
  }

  if (anchorElement.hasAttribute?.('download')) {
    return false;
  }

  if (anchorElement.hasAttribute?.('data-no-route-progress')) {
    return false;
  }

  const hrefAttributeValue = anchorElement.getAttribute?.('href') || '';
  if (!hrefAttributeValue || hrefAttributeValue.startsWith('#')) {
    return false;
  }

  let targetUrl;
  let currentUrl;
  try {
    targetUrl = new URL(hrefAttributeValue, currentPageUrl);
    currentUrl = new URL(currentPageUrl);
  } catch {
    return false;
  }

  if (!INTERNAL_HTTP_PROTOCOLS.has(targetUrl.protocol)) {
    return false;
  }

  if (targetUrl.origin !== currentUrl.origin) {
    return false;
  }

  if (targetUrl.pathname.startsWith('/api/')) {
    return false;
  }

  const isSameDocumentAddress =
    targetUrl.pathname === currentUrl.pathname &&
    targetUrl.search === currentUrl.search;

  return !isSameDocumentAddress;
}
