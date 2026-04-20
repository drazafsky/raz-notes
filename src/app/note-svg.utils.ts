import type { NoteTextElement } from './storage.service';

const DEFAULT_VIEWBOX = '-240 -180 480 360';
export const DEFAULT_TEXT_FONT_SIZE = 24;
export const DEFAULT_TEXT_ELEMENT_WIDTH = 180;

export function estimateTextElementHeight(
  element: Pick<NoteTextElement, 'text' | 'width' | 'height'>,
): number {
  const approxCharsPerLine = Math.max(
    1,
    Math.floor(element.width / Math.max(DEFAULT_TEXT_FONT_SIZE * 0.55, 1)),
  );
  const lineCount = element.text.split('\n').reduce((count, line) => {
    const length = Math.max(line.length, 1);
    return count + Math.max(1, Math.ceil(length / approxCharsPerLine));
  }, 0);
  const contentHeight = Math.max(
    DEFAULT_TEXT_FONT_SIZE * 1.6,
    lineCount * DEFAULT_TEXT_FONT_SIZE * 1.35 + 12,
  );

  return Math.max(contentHeight, element.height ?? 0);
}

export function normalizeNoteTextElement(
  element: Pick<NoteTextElement, 'id' | 'text' | 'x' | 'y'> &
    Partial<Pick<NoteTextElement, 'width' | 'height'>>,
): NoteTextElement {
  const width =
    typeof element.width === 'number' ? Math.max(100, element.width) : DEFAULT_TEXT_ELEMENT_WIDTH;

  return {
    id: element.id,
    text: element.text,
    x: element.x,
    y: element.y,
    width,
    fontSize: DEFAULT_TEXT_FONT_SIZE,
    height: estimateTextElementHeight({
      text: element.text,
      width,
      height: element.height,
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
    minX = Math.min(minX, element.x);
    minY = Math.min(minY, element.y - DEFAULT_TEXT_FONT_SIZE);
    maxX = Math.max(maxX, element.x + element.width);
    maxY = Math.max(maxY, element.y + height);
  }

  const padding = 80;
  return `${minX - padding} ${minY - padding} ${maxX - minX + padding * 2} ${maxY - minY + padding * 2}`;
}
