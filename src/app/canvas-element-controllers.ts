import type { SafeHtml } from '@angular/platform-browser';

import type {
  Attachment,
  Note,
  NoteAttachmentElement,
  NoteChecklistElement,
  NoteChecklistItem,
  NoteTextElement,
} from './storage.service';
import type { CanvasTool, FontOption } from './note-canvas.types';
import type { ChecklistLayoutRow } from './note-svg.utils';

export interface TextCanvasElementController {
  activeTool: CanvasTool;
  selectedElementId: string | null;
  editingElementId: string | null;
  scale: number;
  textToolbarWidth: number;
  textToolbarHeight: number;
  fontFamilyOptions: FontOption[];
  fontSizeOptions: number[];
  quickColorOptions: string[];
  estimateElementHeight(element: NoteTextElement): number;
  fontSizeFor(element: NoteTextElement): number;
  fontFamilyFor(element: NoteTextElement): string;
  textColorFor(element: NoteTextElement): string;
  toolbarTextColorValue(element: NoteTextElement): string;
  textToolbarY(element: NoteTextElement): number;
  elementContentTop(element: NoteTextElement): number;
  trustedRichTextHtmlFor(element: NoteTextElement): SafeHtml;
  inlineEditorId(elementId: string): string;
  onTextPointerDown(event: PointerEvent, elementId: string): void;
  onTextDoubleClick(event: MouseEvent, elementId: string): void;
  onInlineEditorInput(elementId: string, event: Event): void;
  onInlineEditorKeyDown(event: KeyboardEvent): void;
  onInlineEditorPointerDown(event: PointerEvent, elementId: string): void;
  onInlineEditorFocus(elementId: string, event: FocusEvent): void;
  stopEditingElement(event?: FocusEvent): void;
  updateTextStyle(elementId: string, patch: Partial<NoteTextElement>): void;
  changeTextFontSize(elementId: string, value: string | number): void;
  changeTextColor(elementId: string, color: string): void;
  toggleTextFormat(elementId: string, format: 'bold' | 'italic' | 'underline'): void;
  applyInlineTextCommand(
    elementId: string,
    command: 'strikeThrough' | 'subscript' | 'superscript',
  ): void;
}

export interface ChecklistCanvasElementController {
  activeTool: CanvasTool;
  selectedElementId: string | null;
  selectedChecklistItemId: string | null;
  scale: number;
  checklistToolbarWidth: number;
  checklistToolbarHeight: number;
  checklistIndentPx: number;
  fontFamilyOptions: FontOption[];
  fontSizeOptions: number[];
  quickColorOptions: string[];
  estimateElementHeight(element: NoteChecklistElement): number;
  elementContentTop(element: NoteChecklistElement): number;
  checklistToolbarY(element: NoteChecklistElement): number;
  checklistRowsFor(element: NoteChecklistElement): ChecklistLayoutRow[];
  checklistItemIsSelected(elementId: string, itemId: string): boolean;
  checklistItemIsEditing(elementId: string, itemId: string): boolean;
  checklistStateLabel(state: NoteChecklistItem['state']): string;
  checklistStateSymbol(state: NoteChecklistItem['state']): string;
  checklistContainerId(elementId: string): string;
  checklistEditorId(elementId: string, itemId: string): string;
  trustedChecklistItemHtml(item: NoteChecklistItem): SafeHtml;
  activeChecklistDueDate(): string;
  addChecklistSiblingFromToolbar(): void;
  addChecklistChildFromToolbar(): void;
  updateActiveChecklistDueDate(value: string): void;
  clearActiveChecklistDueDate(): void;
  onTextPointerDown(event: PointerEvent, elementId: string): void;
  onTextDoubleClick(event: MouseEvent, elementId: string): void;
  onChecklistContainerPointerDown(event: PointerEvent, elementId: string): void;
  onChecklistContainerPointerUp(event: PointerEvent, elementId: string): void;
  onChecklistItemActivationKeyDown(event: Event, elementId: string, itemId: string): void;
  onChecklistItemInput(elementId: string, itemId: string, event: Event): void;
  onChecklistItemKeyDown(event: KeyboardEvent, elementId: string, itemId: string): void;
  onChecklistItemFocus(elementId: string, itemId: string): void;
  stopChecklistItemEditing(itemId: string, event?: FocusEvent): void;
  onChecklistReorderHandlePointerDown(event: PointerEvent, elementId: string, itemId: string): void;
  cycleChecklistItemState(elementId: string, itemId: string): void;
  deleteChecklistItemFromRow(event: Event, elementId: string, itemId: string): void;
  checklistToolbarFontFamilyValue(): string;
  checklistToolbarFontSizeValue(): number;
  checklistToolbarTextColorValue(): string;
  changeChecklistItemFontFamily(elementId: string, itemId: string, fontFamily: string): void;
  changeChecklistItemFontSize(elementId: string, itemId: string, value: string | number): void;
  changeChecklistItemColor(elementId: string, itemId: string, color: string): void;
  toggleChecklistItemFormat(
    elementId: string,
    itemId: string,
    format: 'bold' | 'italic' | 'underline',
  ): void;
  applyChecklistItemInlineCommand(
    elementId: string,
    itemId: string,
    command: 'strikeThrough' | 'subscript' | 'superscript',
  ): void;
}

export interface AttachmentCanvasElementController {
  activeTool: CanvasTool;
  selectedElementId: string | null;
  scale: number;
  note: Note | null;
  estimateElementHeight(element: NoteAttachmentElement): number;
  elementContentTop(element: NoteAttachmentElement): number;
  attachmentForElement(element: NoteAttachmentElement): Attachment | null;
  attachmentBlobForElement(element: NoteAttachmentElement): Blob | null;
  formatFileSize(bytes: number): string;
  onTextPointerDown(event: PointerEvent, elementId: string): void;
  onTextDoubleClick(event: MouseEvent, elementId: string): void;
  onAttachmentPreviewPointerDown(event: PointerEvent, elementId: string): void;
}
