export function plainTextToRichHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

export function richHtmlToPlainText(html: string): string {
  const container = document.createElement('div');
  container.innerHTML = html;
  return normalizePlainText(container.innerText || container.textContent || '');
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizePlainText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ');
}
