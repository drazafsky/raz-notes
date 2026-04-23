import type {
  NoteAttachmentElement,
  NoteChecklistElement,
  NoteChecklistItem,
  NoteElement,
  NoteTextElement,
} from './storage.service';
import { plainTextToRichHtml, richHtmlToPlainText } from './rich-text.utils';

const DEFAULT_VIEWBOX = '-240 -180 480 360';
export const DEFAULT_TEXT_FONT_SIZE = 24;
export const DEFAULT_TEXT_ELEMENT_WIDTH = 180;
export const DEFAULT_TEXT_FONT_FAMILY = 'Inter, ui-sans-serif, system-ui, sans-serif';
export const DEFAULT_CHECKLIST_ELEMENT_WIDTH = 280;
export const DEFAULT_ATTACHMENT_ELEMENT_WIDTH = 280;
export const DEFAULT_ATTACHMENT_ELEMENT_HEIGHT = 180;
export const CHECKLIST_INDENT_PX = 24;
export const CHECKLIST_ROW_BASE_HEIGHT = 32;
export const CHECKLIST_DUE_DATE_HEIGHT = 24;
export const CHECKLIST_PADDING_Y = 12;
const CHECKLIST_TEXT_WIDTH_OFFSET = 112;

export interface NoteContentBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

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

export function estimateChecklistElementHeight(
  element: Pick<NoteChecklistElement, 'width' | 'height' | 'items'>,
): number {
  const rows = layoutChecklistRows(element);
  const contentHeight =
    rows.length > 0
      ? rows[rows.length - 1].top + rows[rows.length - 1].height + CHECKLIST_PADDING_Y
      : CHECKLIST_ROW_BASE_HEIGHT + CHECKLIST_PADDING_Y * 2;
  const fallbackHeight = Math.max(
    CHECKLIST_ROW_BASE_HEIGHT + CHECKLIST_PADDING_Y * 2,
    contentHeight,
  );
  return Math.max(fallbackHeight, element.height ?? 0);
}

export function normalizeNoteTextElement(
  element: Pick<NoteTextElement, 'id' | 'text' | 'x' | 'y' | 'type'> &
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
    type: 'text',
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

export function normalizeChecklistElement(
  element: Pick<NoteChecklistElement, 'id' | 'x' | 'y' | 'type'> &
    Partial<Pick<NoteChecklistElement, 'width' | 'height'>> & { items?: unknown[] },
): NoteChecklistElement {
  const width =
    typeof element.width === 'number'
      ? Math.max(180, element.width)
      : DEFAULT_CHECKLIST_ELEMENT_WIDTH;
  const items =
    Array.isArray(element.items) && element.items.length > 0
      ? element.items.map((item, index) =>
          normalizeChecklistItem(
            item as Partial<NoteChecklistItem> | Record<string, unknown>,
            index,
          ),
        )
      : [createChecklistItem('Checklist item')];

  return {
    type: 'checklist',
    id: element.id,
    x: element.x,
    y: element.y,
    width,
    items,
    height: estimateChecklistElementHeight({
      width,
      height: element.height,
      items,
    }),
  };
}

export function normalizeAttachmentElement(
  element: Pick<NoteAttachmentElement, 'id' | 'attachmentId' | 'x' | 'y' | 'type'> &
    Partial<Pick<NoteAttachmentElement, 'width' | 'height'>>,
): NoteAttachmentElement {
  const width =
    typeof element.width === 'number'
      ? Math.max(180, element.width)
      : DEFAULT_ATTACHMENT_ELEMENT_WIDTH;
  const height =
    typeof element.height === 'number'
      ? Math.max(120, element.height)
      : DEFAULT_ATTACHMENT_ELEMENT_HEIGHT;

  return {
    type: 'attachment',
    id: element.id,
    attachmentId: element.attachmentId,
    x: element.x,
    y: element.y,
    width,
    height,
  };
}

export function createChecklistItem(text = ''): NoteChecklistItem {
  return {
    id: crypto.randomUUID(),
    text,
    richTextHtml: text ? plainTextToRichHtml(text) : undefined,
    state: 'unchecked',
    children: [],
  };
}

export function normalizeChecklistItem(
  item: Partial<NoteChecklistItem> | Record<string, unknown>,
  index: number,
): NoteChecklistItem {
  const candidate = item as Partial<NoteChecklistItem> & Record<string, unknown>;
  const text = typeof candidate.text === 'string' ? candidate.text : 'Checklist item';
  return {
    id: typeof candidate.id === 'string' ? candidate.id : `checklist-item-${index}`,
    text,
    richTextHtml:
      typeof candidate.richTextHtml === 'string' && candidate.richTextHtml
        ? candidate.richTextHtml
        : plainTextToRichHtml(text),
    state:
      candidate.state === 'checked' ||
      candidate.state === 'partial' ||
      candidate.state === 'unchecked'
        ? candidate.state
        : 'unchecked',
    dueDate:
      typeof candidate.dueDate === 'string' && candidate.dueDate ? candidate.dueDate : undefined,
    children: Array.isArray(candidate.children)
      ? candidate.children.map((child, childIndex) =>
          normalizeChecklistItem(
            child as Partial<NoteChecklistItem> | Record<string, unknown>,
            childIndex,
          ),
        )
      : [],
  };
}

export interface FlattenedChecklistItem {
  item: NoteChecklistItem;
  depth: number;
  parentId: string | null;
}

export function flattenChecklistItems(
  items: NoteChecklistItem[],
  depth = 0,
  parentId: string | null = null,
): FlattenedChecklistItem[] {
  return items.flatMap((item) => [
    { item, depth, parentId },
    ...flattenChecklistItems(item.children, depth + 1, item.id),
  ]);
}

export interface ChecklistLayoutRow extends FlattenedChecklistItem {
  top: number;
  height: number;
  availableWidth: number;
}

export function layoutChecklistRows(
  element: Pick<NoteChecklistElement, 'width' | 'items'>,
): ChecklistLayoutRow[] {
  let top = CHECKLIST_PADDING_Y;
  return flattenChecklistItems(element.items).map((row) => {
    const availableWidth = Math.max(
      120,
      element.width - CHECKLIST_TEXT_WIDTH_OFFSET - row.depth * CHECKLIST_INDENT_PX,
    );
    const height = estimateChecklistRowHeight(row.item, availableWidth);
    const layoutRow: ChecklistLayoutRow = {
      ...row,
      top,
      height,
      availableWidth,
    };
    top += height;
    return layoutRow;
  });
}

function estimateChecklistRowHeight(
  item: Pick<NoteChecklistItem, 'text' | 'dueDate'>,
  availableWidth: number,
): number {
  const approxCharsPerLine = Math.max(1, Math.floor(availableWidth / 8));
  const lineCount = item.text.split('\n').reduce((count, line) => {
    const length = Math.max(line.length, 1);
    return count + Math.max(1, Math.ceil(length / approxCharsPerLine));
  }, 0);
  return (
    Math.max(CHECKLIST_ROW_BASE_HEIGHT, lineCount * 22) +
    (item.dueDate ? CHECKLIST_DUE_DATE_HEIGHT : 0)
  );
}

export function checklistItemRichHtml(item: NoteChecklistItem): string {
  return item.richTextHtml ?? plainTextToRichHtml(item.text);
}

export function checklistItemPlainText(item: NoteChecklistItem): string {
  return richHtmlToPlainText(checklistItemRichHtml(item));
}

export function isTextElement(element: NoteElement): element is NoteTextElement {
  return element.type !== 'checklist' && element.type !== 'attachment';
}

export function isChecklistElement(element: NoteElement): element is NoteChecklistElement {
  return element.type === 'checklist';
}

export function isAttachmentElement(element: NoteElement): element is NoteAttachmentElement {
  return element.type === 'attachment';
}

export function estimateNoteElementHeight(element: NoteElement): number {
  if (isChecklistElement(element)) {
    return estimateChecklistElementHeight(element);
  }

  if (isAttachmentElement(element)) {
    return element.height ?? DEFAULT_ATTACHMENT_ELEMENT_HEIGHT;
  }

  return estimateTextElementHeight(element);
}

export function computeNoteViewBox(elements: NoteElement[]): string {
  const bounds = computeNoteContentBounds(elements);
  if (!bounds) {
    return DEFAULT_VIEWBOX;
  }

  const padding = 80;
  return `${bounds.minX - padding} ${bounds.minY - padding} ${bounds.width + padding * 2} ${bounds.height + padding * 2}`;
}

export function computeNoteContentBounds(elements: NoteElement[]): NoteContentBounds | null {
  if (elements.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const element of elements) {
    const height = estimateNoteElementHeight(element);
    const fontSize = isTextElement(element) ? resolveTextFontSize(element) : 0;
    minX = Math.min(minX, element.x);
    minY = Math.min(minY, isTextElement(element) ? element.y - fontSize : element.y);
    maxX = Math.max(maxX, element.x + element.width);
    maxY = Math.max(maxY, element.y + height);
  }

  const width = maxX - minX;
  const height = maxY - minY;

  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
    centerX: minX + width / 2,
    centerY: minY + height / 2,
  };
}
