import type { NoteTextElement } from './storage.service';

const DEFAULT_VIEWBOX = '-240 -180 480 360';
export const DEFAULT_TEXT_FONT_SIZE = 24;
export const DEFAULT_TEXT_ELEMENT_WIDTH = 180;
export const DEFAULT_TEXT_FONT_FAMILY = 'Inter, ui-sans-serif, system-ui, sans-serif';

function resolveTextFontSize(element: Partial<Pick<NoteTextElement, 'fontSize'>>): number {
  return typeof element.fontSize === 'number'
    ? Math.max(12, element.fontSize)
    : DEFAULT_TEXT_FONT_SIZE;
}

export function estimateTextElementHeight(
  element: Pick<NoteTextElement, 'text' | 'width' | 'height'> &
    Partial<Pick<NoteTextElement, 'fontSize'>>,
): number {
  const fontSize = resolveTextFontSize(element);
  const approxCharsPerLine = Math.max(1, Math.floor(element.width / Math.max(fontSize * 0.55, 1)));
  const lineCount = element.text.split('\n').reduce((count, line) => {
    const length = Math.max(line.length, 1);
    return count + Math.max(1, Math.ceil(length / approxCharsPerLine));
  }, 0);
  const contentHeight = Math.max(fontSize * 1.6, lineCount * fontSize * 1.35 + 12);

  return Math.max(contentHeight, element.height ?? 0);
}

export function normalizeNoteTextElement(
  element: Pick<NoteTextElement, 'id' | 'text' | 'x' | 'y'> &
    Partial<
      Pick<
        NoteTextElement,
        | 'width'
        | 'height'
        | 'fontSize'
        | 'color'
        | 'fontFamily'
        | 'bold'
        | 'italic'
        | 'underline'
        | 'richTextHtml'
      >
    >,
): NoteTextElement {
  const width =
    typeof element.width === 'number' ? Math.max(100, element.width) : DEFAULT_TEXT_ELEMENT_WIDTH;
  const fontSize = resolveTextFontSize(element);

  return {
    id: element.id,
    text: element.text,
    richTextHtml:
      typeof element.richTextHtml === 'string' && element.richTextHtml
        ? element.richTextHtml
        : undefined,
    x: element.x,
    y: element.y,
    width,
    fontSize,
    color: typeof element.color === 'string' && element.color ? element.color : undefined,
    fontFamily:
      typeof element.fontFamily === 'string' && element.fontFamily
        ? element.fontFamily
        : DEFAULT_TEXT_FONT_FAMILY,
    bold: Boolean(element.bold),
    italic: Boolean(element.italic),
    underline: Boolean(element.underline),
    height: estimateTextElementHeight({
      text: element.text,
      width,
      height: element.height,
      fontSize,
    }),
  };
}

export function computeNoteViewBox(elements: NoteTextElement[]): string {
  if (elements.length === 0) {
    return DEFAULT_VIEWBOX;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const element of elements) {
    const height = estimateTextElementHeight(element);
    const fontSize = resolveTextFontSize(element);
    minX = Math.min(minX, element.x);
    minY = Math.min(minY, element.y - fontSize);
    maxX = Math.max(maxX, element.x + element.width);
    maxY = Math.max(maxY, element.y + height);
  }

  const padding = 80;
  return `${minX - padding} ${minY - padding} ${maxX - minX + padding * 2} ${maxY - minY + padding * 2}`;
}
