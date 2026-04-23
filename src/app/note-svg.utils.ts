import { NoteTextElement } from './storage.service';

const DEFAULT_VIEWBOX = '-240 -180 480 360';

export function estimateTextElementHeight(
  element: Pick<NoteTextElement, 'text' | 'width' | 'fontSize'>
): number {
  const approxCharsPerLine = Math.max(1, Math.floor(element.width / Math.max(element.fontSize * 0.55, 1)));
  const lineCount = element.text.split('\n').reduce((count, line) => {
    const length = Math.max(line.length, 1);
    return count + Math.max(1, Math.ceil(length / approxCharsPerLine));
  }, 0);

  return Math.max(element.fontSize * 1.6, lineCount * element.fontSize * 1.35 + 12);
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
    minY = Math.min(minY, element.y - element.fontSize);
    maxX = Math.max(maxX, element.x + element.width);
    maxY = Math.max(maxY, element.y + height);
  }

  const padding = 80;
  return `${minX - padding} ${minY - padding} ${maxX - minX + padding * 2} ${maxY - minY + padding * 2}`;
}
