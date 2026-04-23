import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  inject,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AttachmentViewerComponent } from './attachment-viewer/attachment-viewer.component';
import {
  DEFAULT_ATTACHMENT_ELEMENT_HEIGHT,
  DEFAULT_ATTACHMENT_ELEMENT_WIDTH,
  CHECKLIST_INDENT_PX,
  ChecklistLayoutRow,
  computeNoteContentBounds,
  createChecklistItem,
  DEFAULT_TEXT_ELEMENT_WIDTH,
  DEFAULT_TEXT_FONT_FAMILY,
  DEFAULT_TEXT_FONT_SIZE,
  estimateNoteElementHeight,
  isAttachmentElement,
  isChecklistElement,
  isTextElement,
  layoutChecklistRows,
  normalizeAttachmentElement,
  normalizeChecklistElement,
  normalizeNoteTextElement,
} from './note-svg.utils';
import { plainTextToRichHtml, richHtmlToPlainText } from './rich-text.utils';
import {
  Attachment,
  ChecklistItemState,
  Note,
  NoteAttachmentElement,
  NoteChecklistElement,
  NoteChecklistItem,
  NoteElement,
  NoteTextElement,
} from './storage.service';
import { NotesStateService, PendingAttachment } from './notes-state.service';

type CanvasTool = 'selection' | 'text' | 'checklist';
interface FontOption {
  label: string;
  value: string;
}
interface SaveNotification {
  type: 'success' | 'error';
  message: string;
  dismissable: boolean;
}
type QueryLocalFontsWindow = Window & {
  queryLocalFonts?: () => Promise<{ family: string }[]>;
};
interface ChecklistItemLocation {
  item: NoteChecklistItem;
  parentId: string | null;
  index: number;
  depth: number;
}
interface ElementCanvasBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
interface DragAlignmentGuide {
  orientation: 'vertical' | 'horizontal';
  position: number;
  snapped: boolean;
}
interface CanvasHistorySnapshot {
  elements: NoteElement[];
}
interface ChecklistReorderState {
  elementId: string;
  itemId: string;
  parentId: string | null;
  startIndex: number;
  startItems: NoteChecklistItem[];
}

const FALLBACK_FONT_FAMILIES = [
  'Arial',
  'Arial Black',
  'Calibri',
  'Cambria',
  'Candara',
  'Comic Sans MS',
  'Consolas',
  'Courier New',
  'Georgia',
  'Helvetica',
  'Impact',
  'Inter',
  'Lucida Console',
  'Lucida Sans Unicode',
  'Palatino Linotype',
  'Segoe UI',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
];
const DEFAULT_QUICK_COLORS = [
  '#111827',
  '#ef4444',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#ffffff',
];
const COLOR_USAGE_STORAGE_KEY = 'raz-notes.text-color-usage';
const MIN_CANVAS_SCALE = 0.25;
const MAX_CANVAS_SCALE = 6;
const FIT_CONTENT_PADDING = 72;
const SAVE_NOTIFICATION_DURATION_MS = 3000;
const CHECKLIST_REORDER_STEP_PX = 36;
const GUIDE_EXTENT = 50000;
const DRAG_ALIGNMENT_SNAP_THRESHOLD_PX = 12;

@Component({
  selector: 'app-note-details-page',
  imports: [FormsModule, DatePipe, RouterLink, AttachmentViewerComponent],
  templateUrl: './note-details-page.component.html',
})
export class NoteDetailsPageComponent implements AfterViewInit, OnDestroy {
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly notesState = inject(NotesStateService);

  note: Note | null = null;
  noteError = '';
  saveNotification: SaveNotification | null = null;
  isNewNote = false;
  noteTitle = '';
  elements: NoteElement[] = [];
  readonly textFontSize = DEFAULT_TEXT_FONT_SIZE;
  readonly defaultTextFontFamily = DEFAULT_TEXT_FONT_FAMILY;
  readonly defaultTextColor = '#111827';
  readonly textToolbarWidth = 760;
  readonly textToolbarHeight = 48;
  readonly checklistToolbarWidth = 620;
  readonly checklistToolbarHeight = 48;
  readonly checklistIndentPx = CHECKLIST_INDENT_PX;
  readonly fontSizeOptions = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 60, 72, 96];
  fontFamilyOptions: FontOption[] = FALLBACK_FONT_FAMILIES.map((family) => ({
    label: family,
    value: family,
  }));
  quickColorOptions = [...DEFAULT_QUICK_COLORS];
  pendingAttachments: PendingAttachment[] = [];
  selectedElementId: string | null = null;
  editingElementId: string | null = null;
  selectedChecklistItemId: string | null = null;
  editingChecklistItemId: string | null = null;
  dragAlignmentEnabled = false;
  dragAlignmentGuides: DragAlignmentGuide[] = [];
  activeTool: CanvasTool = 'selection';
  undoStack: CanvasHistorySnapshot[] = [];
  redoStack: CanvasHistorySnapshot[] = [];
  private pendingEditorSelection: 'all' | 'end' | null = null;
  viewX = 480;
  viewY = 280;
  scale = 1;
  isCanvasDragActive = false;

  @ViewChild('fileInput') fileInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('svgHost') svgHostRef?: ElementRef<SVGSVGElement>;

  private interactionMode: 'none' | 'canvas' | 'drag' | 'resize' | 'checklist-reorder' = 'none';
  private interactionMoved = false;
  private activeElementId: string | null = null;
  private pointerStart = { x: 0, y: 0 };
  private viewStart = { x: 0, y: 0 };
  private elementStart = { x: 0, y: 0, width: DEFAULT_TEXT_ELEMENT_WIDTH, height: 0 };
  private editorSelectionRange: Range | null = null;
  private readonly colorUsage = new Map<string, number>();
  private saveNotificationTimeoutId: number | null = null;
  private checklistReorderState: ChecklistReorderState | null = null;
  private interactionHistoryCaptured = false;
  private isReplayingHistory = false;

  constructor() {
    const routeId = this.route.snapshot.paramMap.get('id');
    this.isNewNote = routeId === null;

    if (!routeId) {
      this.initializeColorUsage();
      return;
    }

    const noteId = Number(routeId);
    const note = Number.isFinite(noteId) ? this.notesState.getNote(noteId) : undefined;
    if (!note) {
      void this.router.navigate(['/notes']);
      return;
    }

    this.note = note;
    this.noteTitle = note.title;
    this.elements = note.elements.map((element) => this.cloneElement(element));
    this.selectedElementId = this.elements[0]?.id ?? null;
    this.ensureChecklistItemSelection();
    this.initializeColorUsage();
    this.showPendingNavigationSaveSuccess();
  }

  ngAfterViewInit(): void {
    queueMicrotask(() => {
      this.initializeCanvasView();
      this.changeDetectorRef.detectChanges();
    });
    void this.loadFontFamilyOptions();
  }

  ngOnDestroy(): void {
    this.clearSaveNotificationTimeout();
  }

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    if (files.length > 0) {
      this.addAttachmentFiles(files);
    }
    input.value = '';
  }

  selectFilesForCanvas(): void {
    this.fileInputRef?.nativeElement.click();
  }

  async saveNote(): Promise<void> {
    this.noteError = '';
    this.dismissSaveNotification();
    const title = this.noteTitle.trim();
    if (!title) {
      this.showSaveError('Title is required.');
      return;
    }
    if (this.elements.length === 0) {
      this.showSaveError('Add at least one canvas item to the note.');
      return;
    }

    if (this.isNewNote) {
      try {
        const created = await this.notesState.createNote(
          {
            title,
            elements: this.elements,
          },
          this.pendingAttachments,
        );
        void this.router.navigate(['/notes', created.id], {
          state: { saveSuccessMessage: 'Note saved.' },
        });
      } catch (error) {
        this.showSaveError(error instanceof Error ? error.message : 'Something went wrong.');
      }
      return;
    }

    if (!this.note) {
      this.showSaveError('Note not found.');
      return;
    }

    try {
      this.note = await this.notesState.updateNote(
        this.note.id,
        {
          title,
          elements: this.elements,
        },
        this.pendingAttachments,
      );
      this.pendingAttachments = [];
      this.showSaveSuccess('Note saved.');
    } catch (error) {
      this.showSaveError(error instanceof Error ? error.message : 'Something went wrong.');
    }
  }

  onCanvasDragOver(event: DragEvent): void {
    if (!this.isFileDrag(event)) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    this.isCanvasDragActive = true;
  }

  onCanvasDragLeave(event: DragEvent): void {
    if (event.currentTarget !== event.target) {
      return;
    }

    this.isCanvasDragActive = false;
  }

  onCanvasDrop(event: DragEvent): void {
    this.isCanvasDragActive = false;
    if (!this.isFileDrag(event)) {
      return;
    }

    const files = event.dataTransfer ? Array.from(event.dataTransfer.files) : [];
    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    const point = this.pointerToCanvas(event);
    this.addAttachmentFiles(files, point);
  }

  async deleteNote(): Promise<void> {
    if (!this.note) {
      return;
    }

    await this.notesState.deleteNote(this.note.id);
    void this.router.navigate(['/notes']);
  }

  async deleteAttachment(attachmentId: string): Promise<void> {
    if (!this.note) {
      return;
    }

    this.noteError = '';

    try {
      this.note = await this.notesState.deleteAttachment(this.note.id, attachmentId);
      this.elements = this.elements.filter(
        (element) => !isAttachmentElement(element) || element.attachmentId !== attachmentId,
      );
      this.syncNoteElements();
    } catch (error) {
      this.noteError = error instanceof Error ? error.message : 'Something went wrong.';
    }
  }

  onCanvasPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }

    this.dragAlignmentGuides = [];
    this.interactionMode = 'canvas';
    this.interactionMoved = false;
    this.interactionHistoryCaptured = false;
    this.pointerStart = { x: event.clientX, y: event.clientY };
    this.viewStart = { x: this.viewX, y: this.viewY };
    this.activeElementId = null;
  }

  onTextPointerDown(event: PointerEvent, elementId: string): void {
    if (event.button !== 0) {
      return;
    }

    const element = this.getElement(elementId);
    if (!element) {
      return;
    }

    event.stopPropagation();
    if (this.activeTool !== 'selection') {
      return;
    }

    this.dragAlignmentGuides = [];
    this.cleanupChecklistItemsOnUnselect(elementId);
    this.selectedElementId = elementId;
    if (isChecklistElement(element)) {
      this.selectedChecklistItemId =
        this.selectedChecklistItemId &&
        this.findChecklistItemLocation(elementId, this.selectedChecklistItemId)
          ? this.selectedChecklistItemId
          : (element.items[0]?.id ?? null);
      this.editingChecklistItemId = null;
      this.editingElementId = null;
    } else {
      this.selectedChecklistItemId = null;
    }
    this.activeElementId = elementId;
    this.interactionMode = 'drag';
    this.interactionMoved = false;
    this.interactionHistoryCaptured = false;
    this.pointerStart = { x: event.clientX, y: event.clientY };
    this.elementStart = {
      x: element.x,
      y: element.y,
      width: element.width,
      height: this.estimateElementHeight(element),
    };
  }

  onTextDoubleClick(event: MouseEvent, elementId: string): void {
    event.stopPropagation();
    this.startEditingElement(elementId);
  }

  onResizeHandlePointerDown(event: PointerEvent, elementId: string): void {
    if (event.button !== 0) {
      return;
    }
    if (this.activeTool !== 'selection') {
      return;
    }

    const element = this.getElement(elementId);
    if (!element) {
      return;
    }

    event.stopPropagation();
    this.dragAlignmentGuides = [];
    this.cleanupChecklistItemsOnUnselect(elementId);
    this.selectedElementId = elementId;
    this.selectedChecklistItemId = isChecklistElement(element)
      ? (element.items[0]?.id ?? null)
      : null;
    this.activeElementId = elementId;
    this.interactionMode = 'resize';
    this.interactionMoved = false;
    this.interactionHistoryCaptured = false;
    this.pointerStart = { x: event.clientX, y: event.clientY };
    this.elementStart = {
      x: element.x,
      y: element.y,
      width: element.width,
      height: this.estimateElementHeight(element),
    };
  }

  onCanvasWheel(event: WheelEvent): void {
    event.preventDefault();
    const point = this.pointerToCanvas(event);
    const nextScale = Math.min(
      MAX_CANVAS_SCALE,
      Math.max(MIN_CANVAS_SCALE, this.scale * (event.deltaY < 0 ? 1.1 : 0.9)),
    );
    if (nextScale === this.scale || !this.svgHostRef) {
      return;
    }

    const rect = this.svgHostRef.nativeElement.getBoundingClientRect();
    this.viewX = event.clientX - rect.left - point.x * nextScale;
    this.viewY = event.clientY - rect.top - point.y * nextScale;
    this.scale = nextScale;
  }

  @HostListener('document:pointermove', ['$event'])
  onDocumentPointerMove(event: PointerEvent): void {
    if (this.interactionMode === 'none') {
      return;
    }

    const dx = event.clientX - this.pointerStart.x;
    const dy = event.clientY - this.pointerStart.y;
    if (!this.interactionMoved && Math.abs(dx) + Math.abs(dy) > 3) {
      this.interactionMoved = true;
    }

    if (this.interactionMode === 'canvas') {
      this.viewX = this.viewStart.x + dx;
      this.viewY = this.viewStart.y + dy;
      return;
    }

    if (this.interactionMode === 'checklist-reorder') {
      this.reorderChecklistItemFromPointer(event.clientY - this.pointerStart.y);
      return;
    }

    const element = this.activeElementId ? this.getElement(this.activeElementId) : null;
    if (!element) {
      return;
    }

    if (this.interactionMode === 'drag') {
      this.captureInteractionHistory();
      const proposedX = this.elementStart.x + dx / this.scale;
      const proposedY = this.elementStart.y + dy / this.scale;
      const alignment = this.resolveDragAlignment(element, proposedX, proposedY, event.shiftKey);
      this.dragAlignmentGuides = alignment.guides;
      this.updateElement(
        element.id,
        (currentElement) =>
          isChecklistElement(currentElement)
            ? normalizeChecklistElement({
                ...currentElement,
                x: proposedX + alignment.deltaX,
                y: proposedY + alignment.deltaY,
              })
            : isAttachmentElement(currentElement)
              ? normalizeAttachmentElement({
                  ...currentElement,
                  x: proposedX + alignment.deltaX,
                  y: proposedY + alignment.deltaY,
                })
              : normalizeNoteTextElement({
                  ...currentElement,
                  x: proposedX + alignment.deltaX,
                  y: proposedY + alignment.deltaY,
                }),
        false,
      );
      return;
    }

    this.captureInteractionHistory();
    this.updateElement(
      element.id,
      (currentElement) =>
        isChecklistElement(currentElement)
          ? normalizeChecklistElement({
              ...currentElement,
              width: Math.max(180, this.elementStart.width + dx / this.scale),
              height: Math.max(72, this.elementStart.height + dy / this.scale),
            })
          : isAttachmentElement(currentElement)
            ? normalizeAttachmentElement({
                ...currentElement,
                width: Math.max(180, this.elementStart.width + dx / this.scale),
                height: Math.max(120, this.elementStart.height + dy / this.scale),
              })
            : normalizeNoteTextElement({
                ...currentElement,
                width: Math.max(100, this.elementStart.width + dx / this.scale),
                height: Math.max(48, this.elementStart.height + dy / this.scale),
              }),
      false,
    );
    if (isChecklistElement(element)) {
      this.syncChecklistElementHeightToContent(element.id);
    }
  }

  @HostListener('document:pointerup', ['$event'])
  onDocumentPointerUp(event: PointerEvent): void {
    if (this.interactionMode === 'canvas' && !this.interactionMoved) {
      this.cleanupChecklistItemsOnUnselect(null);
      if (this.activeTool === 'text') {
        const point = this.pointerToCanvas(event);
        this.addTextElement(point.x, point.y);
      } else if (this.activeTool === 'checklist') {
        const point = this.pointerToCanvas(event);
        this.addChecklistElement(point.x, point.y);
      } else {
        this.selectedElementId = null;
        this.editingElementId = null;
        this.selectedChecklistItemId = null;
        this.editingChecklistItemId = null;
      }
    } else if (
      this.interactionMode === 'drag' &&
      !this.interactionMoved &&
      this.activeTool === 'selection' &&
      this.activeElementId
    ) {
      if (this.isTextElementById(this.activeElementId)) {
        this.startEditingElement(this.activeElementId);
      } else {
        const checklistElement = this.getChecklistElement(this.activeElementId);
        const itemId =
          checklistElement &&
          this.selectedChecklistItemId &&
          this.findChecklistItemLocation(checklistElement.id, this.selectedChecklistItemId)
            ? this.selectedChecklistItemId
            : (checklistElement?.items[0]?.id ?? null);
        this.startEditingChecklistItem(this.activeElementId, itemId, 'end', true);
      }
    }

    this.interactionMode = 'none';
    this.activeElementId = null;
    this.interactionMoved = false;
    this.interactionHistoryCaptured = false;
    this.checklistReorderState = null;
    this.dragAlignmentGuides = [];
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeyDown(event: KeyboardEvent): void {
    const target = event.target;
    const isTextInputTarget =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable);

    if (event.ctrlKey && event.key.toLowerCase() === 'z') {
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }
      event.preventDefault();
      this.undoCanvas();
      return;
    }

    if (event.ctrlKey && event.key.toLowerCase() === 'y') {
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }
      event.preventDefault();
      this.redoCanvas();
      return;
    }

    if (!this.selectedElementId || (event.key !== 'Delete' && event.key !== 'Backspace')) {
      return;
    }

    if (isTextInputTarget) {
      return;
    }

    event.preventDefault();
    this.deleteElement(this.selectedElementId);
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  estimateElementHeight(element: NoteElement): number {
    return estimateNoteElementHeight(element);
  }

  richTextHtmlFor(element: NoteTextElement): string {
    return element.richTextHtml ?? plainTextToRichHtml(element.text);
  }

  trustedRichTextHtmlFor(element: NoteTextElement): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(this.richTextHtmlFor(element));
  }

  fontSizeFor(element: NoteTextElement): number {
    return element.fontSize;
  }

  fontFamilyFor(element: NoteTextElement): string {
    return element.fontFamily ?? this.defaultTextFontFamily;
  }

  textColorFor(element: NoteTextElement): string {
    return element.color ?? 'rgb(var(--theme-text) / 1)';
  }

  toolbarTextColorValue(element: NoteTextElement): string {
    return element.color ?? this.defaultTextColor;
  }

  changeTextColor(elementId: string, color: string): void {
    this.recordColorUsage(color);
    this.updateTextStyle(elementId, { color });
  }

  textToolbarY(element: NoteTextElement): number {
    return element.y - this.fontSizeFor(element) - this.textToolbarHeight - 18;
  }

  checklistToolbarY(element: NoteChecklistElement): number {
    return element.y - this.checklistToolbarHeight - 18;
  }

  centerCanvas(): void {
    const rect = this.getSvgHostRect();
    if (!rect) {
      return;
    }

    this.applyCenteredView(rect, this.scale);
  }

  zoomOutToFitCanvas(): void {
    const rect = this.getSvgHostRect();
    if (!rect) {
      return;
    }
    this.applyZoomToFitView(rect, Math.min(this.scale, this.fitScaleForRect(rect)));
  }

  selectedElement(): NoteElement | null {
    return this.selectedElementId ? (this.getElement(this.selectedElementId) ?? null) : null;
  }

  isTextElement(element: NoteElement): element is NoteTextElement {
    return isTextElement(element);
  }

  isChecklistElement(element: NoteElement): element is NoteChecklistElement {
    return isChecklistElement(element);
  }

  isAttachmentElement(element: NoteElement): element is NoteAttachmentElement {
    return isAttachmentElement(element);
  }

  elementContentTop(element: NoteElement): number {
    return isTextElement(element) ? element.y - this.fontSizeFor(element) : element.y;
  }

  attachmentForElement(element: NoteAttachmentElement): Attachment | null {
    return (
      this.pendingAttachments.find((candidate) => candidate.attachment.id === element.attachmentId)
        ?.attachment ??
      this.note?.attachments.find((attachment) => attachment.id === element.attachmentId) ??
      null
    );
  }

  attachmentBlobForElement(element: NoteAttachmentElement): Blob | null {
    return (
      this.pendingAttachments.find((candidate) => candidate.attachment.id === element.attachmentId)
        ?.file ?? null
    );
  }

  unplacedAttachments(): Attachment[] {
    if (!this.note) {
      return [];
    }

    const placedAttachmentIds = new Set(
      this.elements
        .filter((element): element is NoteAttachmentElement => isAttachmentElement(element))
        .map((element) => element.attachmentId),
    );
    return this.note.attachments.filter((attachment) => !placedAttachmentIds.has(attachment.id));
  }

  guideExtentStart(): number {
    return -GUIDE_EXTENT;
  }

  guideExtentEnd(): number {
    return GUIDE_EXTENT;
  }

  dismissSaveNotification(): void {
    this.saveNotification = null;
    this.clearSaveNotificationTimeout();
  }

  toggleDragAlignment(): void {
    this.dragAlignmentEnabled = !this.dragAlignmentEnabled;
    if (!this.dragAlignmentEnabled && this.interactionMode !== 'drag') {
      this.dragAlignmentGuides = [];
    }
  }

  canUndoCanvas(): boolean {
    return this.undoStack.length > 0;
  }

  canRedoCanvas(): boolean {
    return this.redoStack.length > 0;
  }

  undoCanvas(): void {
    if (!this.canUndoCanvas()) {
      return;
    }

    const snapshot = this.undoStack.pop();
    if (!snapshot) {
      return;
    }

    this.redoStack.push(this.captureCanvasHistorySnapshot());
    this.applyCanvasHistorySnapshot(snapshot);
  }

  redoCanvas(): void {
    if (!this.canRedoCanvas()) {
      return;
    }

    const snapshot = this.redoStack.pop();
    if (!snapshot) {
      return;
    }

    this.undoStack.push(this.captureCanvasHistorySnapshot());
    this.applyCanvasHistorySnapshot(snapshot);
  }

  setActiveTool(tool: CanvasTool): void {
    this.activeTool = tool;
    this.dragAlignmentGuides = [];
    if (tool !== 'selection') {
      this.editingElementId = null;
      this.editingChecklistItemId = null;
      this.editorSelectionRange = null;
    }
  }

  updateEditingText(elementId: string, text: string): void {
    this.updateTextElement(elementId, { text, richTextHtml: plainTextToRichHtml(text) });
  }

  updateTextStyle(elementId: string, patch: Partial<NoteTextElement>): void {
    const applied = this.applyStyleToSelection(elementId, () => {
      if (patch.color) {
        document.execCommand('styleWithCSS', false, 'true');
        document.execCommand('foreColor', false, patch.color);
      }
      if (patch.fontFamily) {
        document.execCommand('styleWithCSS', false, 'true');
        document.execCommand('fontName', false, patch.fontFamily);
      }
    });

    if (!applied) {
      this.updateTextElement(elementId, patch);
    }
  }

  changeTextFontSize(elementId: string, value: string | number): void {
    const fontSize = Number(value);
    if (!Number.isFinite(fontSize)) {
      return;
    }

    const nextFontSize = Math.max(12, fontSize);
    const applied = this.applyStyleToSelection(elementId, () =>
      this.wrapSelectionWithStyledSpan({ fontSize: `${nextFontSize}px` }),
    );

    if (!applied) {
      this.updateTextElement(elementId, { fontSize: nextFontSize });
    }
  }

  toggleTextFormat(elementId: string, format: 'bold' | 'italic' | 'underline'): void {
    const element = this.getTextElement(elementId);
    if (!element) {
      return;
    }

    switch (format) {
      case 'bold':
        if (!this.applyCommandToSelection(elementId, 'bold')) {
          this.updateTextElement(elementId, { bold: !element.bold });
        }
        return;
      case 'italic':
        if (!this.applyCommandToSelection(elementId, 'italic')) {
          this.updateTextElement(elementId, { italic: !element.italic });
        }
        return;
      case 'underline':
        if (!this.applyCommandToSelection(elementId, 'underline')) {
          this.updateTextElement(elementId, { underline: !element.underline });
        }
        return;
    }
  }

  applyInlineTextCommand(
    elementId: string,
    command: 'strikeThrough' | 'subscript' | 'superscript',
  ): void {
    this.applyEditorCommand(elementId, command, true);
  }

  private addTextElement(x: number, y: number): void {
    this.recordCanvasHistory();
    const element = normalizeNoteTextElement({
      id: crypto.randomUUID(),
      text: 'New text',
      x,
      y,
      width: DEFAULT_TEXT_ELEMENT_WIDTH,
    });
    this.elements = [...this.elements, element];
    this.activeTool = 'selection';
    this.selectedElementId = element.id;
    this.startEditingElement(element.id, 'all');
  }

  private addChecklistElement(x: number, y: number): void {
    this.recordCanvasHistory();
    const element = normalizeChecklistElement({
      id: crypto.randomUUID(),
      type: 'checklist',
      x,
      y,
      items: [createChecklistItem('Checklist item')],
    });
    this.elements = [...this.elements, element];
    this.syncNoteElements();
    this.activeTool = 'selection';
    this.selectedElementId = element.id;
    this.selectedChecklistItemId = element.items[0]?.id ?? null;
    this.startEditingChecklistItem(element.id, element.items[0]?.id ?? null, 'all');
  }

  private addAttachmentFiles(files: File[], origin?: { x: number; y: number }): void {
    if (files.length === 0) {
      return;
    }

    const start = origin ?? this.defaultAttachmentInsertionPoint();
    this.recordCanvasHistory();
    const nextPendingAttachments = [...this.pendingAttachments];
    const nextElements = [...this.elements];

    files.forEach((file, index) => {
      const attachment: Attachment = {
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type,
        size: file.size,
      };
      nextPendingAttachments.push({ attachment, file });
      nextElements.push(
        normalizeAttachmentElement({
          id: crypto.randomUUID(),
          type: 'attachment',
          attachmentId: attachment.id,
          x: start.x + index * 24,
          y: start.y + index * 24,
          width: DEFAULT_ATTACHMENT_ELEMENT_WIDTH,
          height: DEFAULT_ATTACHMENT_ELEMENT_HEIGHT,
        }),
      );
    });

    this.pendingAttachments = nextPendingAttachments;
    this.elements = nextElements;
    this.activeTool = 'selection';
    this.selectedElementId = nextElements.at(-1)?.id ?? null;
    this.syncNoteElements();
  }

  private defaultAttachmentInsertionPoint(): { x: number; y: number } {
    const rect = this.getSvgHostRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }

    return {
      x: (rect.width / 2 - this.viewX) / this.scale - DEFAULT_ATTACHMENT_ELEMENT_WIDTH / 2,
      y: (rect.height / 2 - this.viewY) / this.scale - DEFAULT_ATTACHMENT_ELEMENT_HEIGHT / 2,
    };
  }

  onInlineEditorPointerDown(event: PointerEvent, elementId: string): void {
    event.stopPropagation();
    this.selectedElementId = elementId;
  }

  onInlineEditorInput(elementId: string, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLDivElement)) {
      return;
    }

    this.syncElementFromEditor(elementId, target);
  }

  onInlineEditorKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      document.execCommand('insertLineBreak');
    }
  }

  onInlineEditorFocus(elementId: string, event: FocusEvent): void {
    if (this.editingElementId !== elementId) {
      return;
    }

    const input = event.target;
    if (!(input instanceof HTMLDivElement)) {
      return;
    }

    this.applyPendingEditorSelection(input);
  }

  stopEditingElement(event?: FocusEvent): void {
    const nextTarget = event?.relatedTarget;
    if (
      nextTarget instanceof HTMLElement &&
      nextTarget.closest('[data-text-toolbar="true"], [data-checklist-toolbar="true"]')
    ) {
      return;
    }

    this.editingElementId = null;
    this.pendingEditorSelection = null;
    this.editorSelectionRange = null;
  }

  private resolveDragAlignment(
    element: NoteElement,
    proposedX: number,
    proposedY: number,
    shiftKey: boolean,
  ): { deltaX: number; deltaY: number; guides: DragAlignmentGuide[] } {
    if (!this.dragAlignmentEnabled && !shiftKey) {
      return { deltaX: 0, deltaY: 0, guides: [] };
    }

    const candidateBounds = this.elements
      .filter((candidate) => candidate.id !== element.id)
      .map((candidate) => this.getElementCanvasBounds(candidate));
    const verticalPositions = [
      ...new Set(candidateBounds.flatMap((bounds) => [bounds.left, bounds.right])),
    ];
    const horizontalPositions = [
      ...new Set(candidateBounds.flatMap((bounds) => [bounds.top, bounds.bottom])),
    ];
    const proposedBounds = this.getElementCanvasBounds(element, proposedX, proposedY);
    const tolerance = DRAG_ALIGNMENT_SNAP_THRESHOLD_PX / this.scale;

    const nearestVertical = this.findNearestGuideDelta(
      [proposedBounds.left, proposedBounds.right],
      verticalPositions,
      tolerance,
    );
    const nearestHorizontal = this.findNearestGuideDelta(
      [proposedBounds.top, proposedBounds.bottom],
      horizontalPositions,
      tolerance,
    );

    return {
      deltaX: nearestVertical?.delta ?? 0,
      deltaY: nearestHorizontal?.delta ?? 0,
      guides: [
        ...verticalPositions.map((position) => ({
          orientation: 'vertical' as const,
          position,
          snapped: position === nearestVertical?.position,
        })),
        ...horizontalPositions.map((position) => ({
          orientation: 'horizontal' as const,
          position,
          snapped: position === nearestHorizontal?.position,
        })),
      ],
    };
  }

  private getElementCanvasBounds(
    element: NoteElement,
    x = element.x,
    y = element.y,
  ): ElementCanvasBounds {
    const top = isTextElement(element) ? y - this.fontSizeFor(element) : y;
    const height = this.estimateElementHeight(element);
    return {
      left: x,
      right: x + element.width,
      top,
      bottom: top + height,
    };
  }

  private findNearestGuideDelta(
    movingEdges: number[],
    guidePositions: number[],
    tolerance: number,
  ): { position: number; delta: number } | null {
    let nearest: { position: number; delta: number } | null = null;

    for (const guidePosition of guidePositions) {
      for (const movingEdge of movingEdges) {
        const delta = guidePosition - movingEdge;
        if (Math.abs(delta) > tolerance) {
          continue;
        }

        if (!nearest || Math.abs(delta) < Math.abs(nearest.delta)) {
          nearest = { position: guidePosition, delta };
        }
      }
    }

    return nearest;
  }

  private updateElement(
    elementId: string,
    updater: (element: NoteElement) => NoteElement,
    recordHistory = true,
  ): void {
    if (recordHistory) {
      this.recordCanvasHistory();
    }
    this.elements = this.elements.map((element) =>
      element.id === elementId ? updater(element) : element,
    );
    this.syncNoteElements();
  }

  private updateTextElement(elementId: string, patch: Partial<NoteTextElement>): void {
    this.updateElement(elementId, (element) =>
      isTextElement(element) ? normalizeNoteTextElement({ ...element, ...patch }) : element,
    );
  }

  private updateChecklistElement(
    elementId: string,
    updater: (element: NoteChecklistElement) => NoteChecklistElement,
    syncHeightToContent = true,
    recordHistory = true,
  ): void {
    this.updateElement(
      elementId,
      (element) =>
        isChecklistElement(element) ? normalizeChecklistElement(updater(element)) : element,
      recordHistory,
    );
    if (syncHeightToContent) {
      this.syncChecklistElementHeightToContent(elementId);
    }
  }

  private recordCanvasHistory(): void {
    if (this.isReplayingHistory) {
      return;
    }

    this.undoStack.push(this.captureCanvasHistorySnapshot());
    this.redoStack = [];
  }

  private captureCanvasHistorySnapshot(): CanvasHistorySnapshot {
    return {
      elements: this.elements.map((element) => this.cloneElement(element)),
    };
  }

  private applyCanvasHistorySnapshot(snapshot: CanvasHistorySnapshot): void {
    this.isReplayingHistory = true;
    this.elements = snapshot.elements.map((element) => this.cloneElement(element));
    this.selectedElementId =
      this.selectedElementId && this.getElement(this.selectedElementId)
        ? this.selectedElementId
        : null;
    this.selectedChecklistItemId =
      this.selectedElementId && this.selectedChecklistItemId
        ? (this.findChecklistItemLocation(this.selectedElementId, this.selectedChecklistItemId)
            ?.item.id ?? null)
        : null;
    this.editingElementId = null;
    this.editingChecklistItemId = null;
    this.pendingEditorSelection = null;
    this.editorSelectionRange = null;
    this.dragAlignmentGuides = [];
    this.syncNoteElements();
    this.isReplayingHistory = false;
    this.changeDetectorRef.detectChanges();
  }

  private captureInteractionHistory(): void {
    if (!this.interactionMoved || this.interactionHistoryCaptured) {
      return;
    }

    this.recordCanvasHistory();
    this.interactionHistoryCaptured = true;
  }

  private syncNoteElements(): void {
    this.pruneDetachedPendingAttachments();
    this.ensureChecklistItemSelection();
    if (this.note) {
      this.note = {
        ...this.note,
        elements: this.elements,
        lastModifiedAt: new Date().toISOString(),
      };
    }
  }

  private deleteElement(elementId: string): void {
    this.recordCanvasHistory();
    this.elements = this.elements.filter((element) => element.id !== elementId);
    this.selectedElementId = this.elements[0]?.id ?? null;
    if (this.editingElementId === elementId) {
      this.editingElementId = null;
    }
    if (this.selectedElementId !== elementId) {
      this.ensureChecklistItemSelection();
    } else {
      this.selectedChecklistItemId = null;
      this.editingChecklistItemId = null;
    }
    this.syncNoteElements();
  }

  private getElement(elementId: string): NoteElement | undefined {
    return this.elements.find((element) => element.id === elementId);
  }

  private getTextElement(elementId: string): NoteTextElement | undefined {
    const element = this.getElement(elementId);
    return element && isTextElement(element) ? element : undefined;
  }

  private getChecklistElement(elementId: string): NoteChecklistElement | undefined {
    const element = this.getElement(elementId);
    return element && isChecklistElement(element) ? element : undefined;
  }

  inlineEditorId(elementId: string): string {
    return `text-editor-${elementId}`;
  }

  checklistEditorId(elementId: string, itemId: string): string {
    return `checklist-editor-${elementId}-${itemId}`;
  }

  checklistContainerId(elementId: string): string {
    return `checklist-container-${elementId}`;
  }

  checklistRowsFor(element: NoteChecklistElement): ChecklistLayoutRow[] {
    return layoutChecklistRows(element);
  }

  checklistItemHtml(item: NoteChecklistItem): string {
    return item.richTextHtml ?? plainTextToRichHtml(item.text);
  }

  trustedChecklistItemHtml(item: NoteChecklistItem): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(this.checklistItemHtml(item));
  }

  checklistItemIsEditing(elementId: string, itemId: string): boolean {
    return this.selectedElementId === elementId && this.editingChecklistItemId === itemId;
  }

  checklistItemIsSelected(elementId: string, itemId: string): boolean {
    return this.selectedElementId === elementId && this.selectedChecklistItemId === itemId;
  }

  checklistStateSymbol(state: ChecklistItemState): string {
    switch (state) {
      case 'checked':
        return '☑';
      case 'partial':
        return '◩';
      default:
        return '☐';
    }
  }

  checklistStateLabel(state: ChecklistItemState): string {
    switch (state) {
      case 'checked':
        return 'Checked';
      case 'partial':
        return 'Partially checked';
      default:
        return 'Unchecked';
    }
  }

  activeChecklistItem(): NoteChecklistItem | null {
    if (!this.selectedElementId || !this.selectedChecklistItemId) {
      return null;
    }

    const location = this.findChecklistItemLocation(
      this.selectedElementId,
      this.selectedChecklistItemId,
    );
    return location?.item ?? null;
  }

  activeChecklistDueDate(): string {
    return this.activeChecklistItem()?.dueDate ?? '';
  }

  addChecklistSiblingFromToolbar(): void {
    if (!this.selectedElementId || !this.selectedChecklistItemId) {
      return;
    }

    this.insertChecklistSibling(this.selectedElementId, this.selectedChecklistItemId);
  }

  addChecklistChildFromToolbar(): void {
    if (!this.selectedElementId || !this.selectedChecklistItemId) {
      return;
    }

    this.insertChecklistChild(this.selectedElementId, this.selectedChecklistItemId);
  }

  deleteChecklistItemFromRow(event: Event, elementId: string, itemId: string): void {
    event.stopPropagation();
    this.selectedElementId = elementId;
    this.selectedChecklistItemId = itemId;
    this.deleteChecklistItem(elementId, itemId);
  }

  updateActiveChecklistDueDate(value: string): void {
    if (!this.selectedElementId || !this.selectedChecklistItemId) {
      return;
    }

    this.setChecklistItemDueDate(
      this.selectedElementId,
      this.selectedChecklistItemId,
      value.trim() || undefined,
    );
  }

  clearActiveChecklistDueDate(): void {
    if (!this.selectedElementId || !this.selectedChecklistItemId) {
      return;
    }

    this.setChecklistItemDueDate(this.selectedElementId, this.selectedChecklistItemId, undefined);
  }

  checklistToolbarFontFamilyValue(): string {
    return this.defaultTextFontFamily;
  }

  checklistToolbarFontSizeValue(): number {
    return DEFAULT_TEXT_FONT_SIZE;
  }

  checklistToolbarTextColorValue(): string {
    return this.defaultTextColor;
  }

  changeChecklistItemColor(elementId: string, itemId: string, color: string): void {
    this.recordColorUsage(color);
    this.applyChecklistStyleToSelection(
      elementId,
      itemId,
      () => {
        document.execCommand('styleWithCSS', false, 'true');
        document.execCommand('foreColor', false, color);
      },
      true,
    );
  }

  changeChecklistItemFontFamily(elementId: string, itemId: string, fontFamily: string): void {
    this.applyChecklistStyleToSelection(
      elementId,
      itemId,
      () => {
        document.execCommand('styleWithCSS', false, 'true');
        document.execCommand('fontName', false, fontFamily);
      },
      true,
    );
  }

  changeChecklistItemFontSize(elementId: string, itemId: string, value: string | number): void {
    const fontSize = Number(value);
    if (!Number.isFinite(fontSize)) {
      return;
    }

    this.applyChecklistStyleToSelection(
      elementId,
      itemId,
      () => this.wrapSelectionWithStyledSpan({ fontSize: `${Math.max(12, fontSize)}px` }),
      true,
    );
  }

  toggleChecklistItemFormat(
    elementId: string,
    itemId: string,
    format: 'bold' | 'italic' | 'underline',
  ): void {
    this.applyChecklistItemEditorCommand(elementId, itemId, format);
  }

  applyChecklistItemInlineCommand(
    elementId: string,
    itemId: string,
    command: 'strikeThrough' | 'subscript' | 'superscript',
  ): void {
    this.applyChecklistItemEditorCommand(elementId, itemId, command);
  }

  onChecklistContainerPointerDown(event: PointerEvent, elementId: string): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget) {
      return;
    }

    this.onTextPointerDown(event, elementId);
  }

  onChecklistContainerPointerUp(event: PointerEvent, elementId: string): void {
    if (this.interactionMode !== 'none') {
      return;
    }

    event.stopPropagation();
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (
      target.closest(
        'button, input, select, textarea, [contenteditable="true"], [data-checklist-item-toolbar="true"], [data-checklist-toolbar="true"]',
      )
    ) {
      return;
    }

    const row = target.closest<HTMLElement>('[data-checklist-item-id]');
    const itemId = row?.dataset['checklistItemId'];
    if (!itemId) {
      return;
    }

    this.activateChecklistItemEditing(elementId, itemId);
  }

  onAttachmentPreviewPointerDown(event: PointerEvent, elementId: string): void {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest('a, button, input, select, textarea, audio, video, iframe')
    ) {
      event.stopPropagation();
      return;
    }

    this.onTextPointerDown(event, elementId);
  }

  onChecklistItemActivationKeyDown(event: Event, elementId: string, itemId: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.activateChecklistItemEditing(elementId, itemId);
  }

  onChecklistItemInput(elementId: string, itemId: string, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLDivElement)) {
      return;
    }

    this.updateChecklistItemText(elementId, itemId, target.innerHTML);
  }

  onChecklistItemKeyDown(event: KeyboardEvent, elementId: string, itemId: string): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.insertChecklistSibling(elementId, itemId);
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      this.insertChecklistChild(elementId, itemId);
    }
  }

  onChecklistItemFocus(elementId: string, itemId: string): void {
    this.selectedElementId = elementId;
    this.selectedChecklistItemId = itemId;
    this.editingChecklistItemId = itemId;
  }

  stopChecklistItemEditing(itemId: string, event?: FocusEvent): void {
    const nextTarget = event?.relatedTarget;
    if (
      nextTarget instanceof HTMLElement &&
      nextTarget.closest('[data-checklist-toolbar="true"], [data-checklist-item-toolbar="true"]')
    ) {
      return;
    }

    if (this.editingChecklistItemId !== itemId) {
      return;
    }

    this.editingChecklistItemId = null;
    this.pendingEditorSelection = null;
    this.editorSelectionRange = null;
  }

  cycleChecklistItemState(elementId: string, itemId: string): void {
    const item = this.findChecklistItemLocation(elementId, itemId)?.item;
    if (!item) {
      return;
    }

    const nextState: ChecklistItemState =
      item.state === 'unchecked' ? 'partial' : item.state === 'partial' ? 'checked' : 'unchecked';
    this.updateChecklistItem(elementId, itemId, (currentItem) => ({
      ...currentItem,
      state: nextState,
    }));
  }

  onChecklistReorderHandlePointerDown(
    event: PointerEvent,
    elementId: string,
    itemId: string,
  ): void {
    if (event.button !== 0 || this.activeTool !== 'selection') {
      return;
    }

    const element = this.getChecklistElement(elementId);
    const location = this.findChecklistItemLocation(elementId, itemId);
    if (!element || !location) {
      return;
    }

    event.stopPropagation();
    this.selectedElementId = elementId;
    this.selectedChecklistItemId = itemId;
    this.interactionMode = 'checklist-reorder';
    this.interactionMoved = false;
    this.pointerStart = { x: event.clientX, y: event.clientY };
    this.checklistReorderState = {
      elementId,
      itemId,
      parentId: location.parentId,
      startIndex: location.index,
      startItems: this.cloneChecklistItems(element.items),
    };
  }

  @HostListener('document:selectionchange')
  onDocumentSelectionChange(): void {
    const editor =
      this.editingElementId !== null
        ? this.getInlineEditorElement(this.editingElementId)
        : this.selectedElementId && this.editingChecklistItemId
          ? this.getChecklistEditorElement(this.selectedElementId, this.editingChecklistItemId)
          : null;
    if (!editor) {
      return;
    }

    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      this.editorSelectionRange = range.cloneRange();
    }
  }

  private startEditingElement(elementId: string, selection: 'all' | 'end' = 'end'): void {
    if (!this.getTextElement(elementId)) {
      return;
    }

    this.selectedElementId = elementId;
    this.selectedChecklistItemId = null;
    this.editingElementId = elementId;
    this.editingChecklistItemId = null;
    this.pendingEditorSelection = selection;
    queueMicrotask(() => {
      this.changeDetectorRef.detectChanges();
      const input = document.getElementById(this.inlineEditorId(elementId));
      if (input instanceof HTMLDivElement) {
        const element = this.getTextElement(elementId);
        input.innerHTML = element ? this.richTextHtmlFor(element) : '';
        input.focus();
        this.applyPendingEditorSelection(input);
      }
    });
  }

  private applyPendingEditorSelection(input: HTMLDivElement): void {
    if (this.pendingEditorSelection === null) {
      return;
    }

    const selection = this.pendingEditorSelection;
    const applySelection = () => {
      const domSelection = window.getSelection();
      if (!domSelection) {
        return;
      }
      const range = document.createRange();
      range.selectNodeContents(input);
      if (selection === 'end') {
        range.collapse(false);
      }
      domSelection.removeAllRanges();
      domSelection.addRange(range);
      this.editorSelectionRange = range.cloneRange();
    };

    applySelection();
    if (selection === 'all') {
      requestAnimationFrame(() => {
        if (document.activeElement === input) {
          applySelection();
        }
      });
    }

    this.pendingEditorSelection = null;
  }

  private getInlineEditorElement(elementId: string): HTMLDivElement | null {
    const editor = document.getElementById(this.inlineEditorId(elementId));
    return editor instanceof HTMLDivElement ? editor : null;
  }

  private syncElementFromEditor(elementId: string, editor: HTMLDivElement): void {
    this.updateTextElement(elementId, {
      text: richHtmlToPlainText(editor.innerHTML),
      richTextHtml: editor.innerHTML,
    });
  }

  private getChecklistEditorElement(elementId: string, itemId: string): HTMLDivElement | null {
    const editor = document.getElementById(this.checklistEditorId(elementId, itemId));
    return editor instanceof HTMLDivElement ? editor : null;
  }

  private getChecklistContainerElement(elementId: string): HTMLDivElement | null {
    const container = document.getElementById(this.checklistContainerId(elementId));
    return container instanceof HTMLDivElement ? container : null;
  }

  private startEditingChecklistItem(
    elementId: string,
    itemId: string | null,
    selection: 'all' | 'end' = 'end',
    delayRender = false,
  ): void {
    if (!itemId || !this.findChecklistItemLocation(elementId, itemId)) {
      return;
    }

    this.selectedElementId = elementId;
    this.selectedChecklistItemId = itemId;
    this.editingElementId = null;
    this.editingChecklistItemId = itemId;
    this.pendingEditorSelection = selection;
    const renderEditor = () => {
      if (this.editingChecklistItemId !== itemId) {
        return;
      }

      this.changeDetectorRef.detectChanges();

      const editor = this.getChecklistEditorElement(elementId, itemId);
      if (!editor) {
        return;
      }

      const item = this.findChecklistItemLocation(elementId, itemId)?.item;
      editor.innerHTML = item ? this.checklistItemHtml(item) : '';
      const focusEditor = () => {
        editor.focus();
        this.applyPendingEditorSelection(editor);
      };

      focusEditor();
      setTimeout(() => {
        if (this.editingChecklistItemId === itemId) {
          focusEditor();
        }
      });
    };

    if (delayRender) {
      setTimeout(renderEditor);
      return;
    }

    queueMicrotask(renderEditor);
  }

  private activateChecklistItemEditing(elementId: string, itemId: string): void {
    this.selectedElementId = elementId;
    this.selectedChecklistItemId = itemId;
    this.startEditingChecklistItem(elementId, itemId, 'end', true);
  }

  private updateChecklistItemText(elementId: string, itemId: string, richTextHtml: string): void {
    this.updateChecklistItem(elementId, itemId, (item) => ({
      ...item,
      text: richHtmlToPlainText(richTextHtml),
      richTextHtml,
    }));
  }

  private updateChecklistItem(
    elementId: string,
    itemId: string,
    updater: (item: NoteChecklistItem) => NoteChecklistItem,
  ): void {
    this.updateChecklistElement(elementId, (element) => ({
      ...element,
      items: this.mapChecklistItems(element.items, itemId, updater),
    }));
  }

  private insertChecklistSibling(elementId: string, itemId: string): void {
    const location = this.findChecklistItemLocation(elementId, itemId);
    if (!location) {
      return;
    }

    const nextItem = createChecklistItem('');
    this.updateChecklistElement(elementId, (element) => ({
      ...element,
      items: this.insertChecklistItemIntoParent(
        element.items,
        location.parentId,
        location.index + 1,
        nextItem,
      ),
    }));
    this.startEditingChecklistItem(elementId, nextItem.id, 'all');
  }

  private insertChecklistChild(elementId: string, itemId: string): void {
    const nextItem = createChecklistItem('');
    this.updateChecklistItem(elementId, itemId, (item) => ({
      ...item,
      children: [...item.children, nextItem],
    }));
    this.startEditingChecklistItem(elementId, nextItem.id, 'all');
  }

  private deleteChecklistItem(elementId: string, itemId: string): void {
    const element = this.getChecklistElement(elementId);
    const location = this.findChecklistItemLocation(elementId, itemId);
    if (!element || !location) {
      return;
    }

    const siblingIds = this.getChecklistSiblings(element.items, location.parentId).map(
      (item) => item.id,
    );
    const fallbackSelectionId =
      siblingIds[location.index + 1] ?? siblingIds[location.index - 1] ?? location.parentId ?? null;

    const nextItems = this.removeChecklistItemFromParent(element.items, location.parentId, itemId);
    if (nextItems.length === 0) {
      const replacement = createChecklistItem('');
      this.updateChecklistElement(elementId, (currentElement) => ({
        ...currentElement,
        items: [replacement],
      }));
      this.startEditingChecklistItem(elementId, replacement.id, 'all');
      return;
    }

    this.updateChecklistElement(elementId, (currentElement) => ({
      ...currentElement,
      items: nextItems,
    }));

    this.editingChecklistItemId = null;
    this.editorSelectionRange = null;
    this.selectedChecklistItemId = fallbackSelectionId;
  }

  private cleanupChecklistItemsOnUnselect(nextSelectedElementId: string | null): void {
    if (!this.selectedElementId || this.selectedElementId === nextSelectedElementId) {
      return;
    }

    const currentChecklist = this.getChecklistElement(this.selectedElementId);
    if (!currentChecklist) {
      return;
    }

    const prunedItems = this.pruneEmptyChecklistItems(currentChecklist.items);
    this.updateChecklistElement(currentChecklist.id, (element) => ({
      ...element,
      items: prunedItems.length > 0 ? prunedItems : [createChecklistItem('')],
    }));
  }

  private setChecklistItemDueDate(
    elementId: string,
    itemId: string,
    dueDate: string | undefined,
  ): void {
    this.updateChecklistItem(elementId, itemId, (item) => ({
      ...item,
      dueDate,
    }));
  }

  private syncChecklistElementHeightToContent(elementId: string): void {
    setTimeout(() => {
      this.changeDetectorRef.detectChanges();
      const element = this.getChecklistElement(elementId);
      const container = this.getChecklistContainerElement(elementId);
      if (!element || !container) {
        return;
      }

      const requiredHeight = Math.ceil(container.scrollHeight);
      const currentHeight = element.height ?? this.estimateElementHeight(element);
      if (requiredHeight <= currentHeight) {
        return;
      }

      this.updateChecklistElement(
        elementId,
        (currentElement) => ({
          ...currentElement,
          height: requiredHeight,
        }),
        false,
      );
    });
  }

  private reorderChecklistItemFromPointer(deltaY: number): void {
    const state = this.checklistReorderState;
    if (!state) {
      return;
    }

    const element = this.getChecklistElement(state.elementId);
    if (!element) {
      return;
    }

    const siblings = this.getChecklistSiblings(element.items, state.parentId);
    const targetIndex = Math.max(
      0,
      Math.min(
        siblings.length - 1,
        state.startIndex + Math.round(deltaY / CHECKLIST_REORDER_STEP_PX),
      ),
    );
    if (targetIndex === state.startIndex) {
      return;
    }

    this.captureInteractionHistory();
    this.elements = this.elements.map((candidate) =>
      candidate.id === state.elementId && isChecklistElement(candidate)
        ? normalizeChecklistElement({
            ...candidate,
            items: this.moveChecklistItemWithinParent(
              this.cloneChecklistItems(state.startItems),
              state.parentId,
              state.startIndex,
              targetIndex,
            ),
          })
        : candidate,
    );
    this.syncNoteElements();
  }

  private applyCommandToSelection(
    elementId: string,
    command: 'bold' | 'italic' | 'underline',
  ): boolean {
    return this.applyEditorCommand(elementId, command, true);
  }

  private applyStyleToSelection(
    elementId: string,
    applySelectionCommand: (editor: HTMLDivElement) => void,
    allowCollapsed = false,
  ): boolean {
    return this.applyStyleToEditorSelection(
      () => this.getInlineEditorElement(elementId),
      (editor) => this.syncElementFromEditor(elementId, editor),
      applySelectionCommand,
      allowCollapsed,
    );
  }

  private applyChecklistStyleToSelection(
    elementId: string,
    itemId: string,
    applySelectionCommand: (editor: HTMLDivElement) => void,
    allowCollapsed = false,
  ): boolean {
    return this.applyStyleToEditorSelection(
      () => this.getChecklistEditorElement(elementId, itemId),
      (editor) => this.updateChecklistItemText(elementId, itemId, editor.innerHTML),
      applySelectionCommand,
      allowCollapsed,
    );
  }

  private applyStyleToEditorSelection(
    getEditor: () => HTMLDivElement | null,
    syncEditor: (editor: HTMLDivElement) => void,
    applySelectionCommand: (editor: HTMLDivElement) => void,
    allowCollapsed = false,
  ): boolean {
    const editor = getEditor();
    if (!editor || !this.restoreEditorSelection(editor)) {
      return false;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || (!allowCollapsed && selection.isCollapsed)) {
      return false;
    }

    applySelectionCommand(editor);
    syncEditor(editor);
    this.captureEditorSelection(editor);
    return true;
  }

  private wrapSelectionWithStyledSpan(styles: Partial<CSSStyleDeclaration>): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (range.collapsed) {
      return;
    }

    const span = document.createElement('span');
    Object.assign(span.style, styles);

    try {
      range.surroundContents(span);
    } catch {
      const contents = range.extractContents();
      span.append(contents);
      range.insertNode(span);
    }

    selection.removeAllRanges();
    const nextRange = document.createRange();
    nextRange.selectNodeContents(span);
    selection.addRange(nextRange);
    this.editorSelectionRange = nextRange.cloneRange();
  }

  private restoreEditorSelection(editor: HTMLDivElement): boolean {
    const selection = window.getSelection();
    if (!selection) {
      return false;
    }

    editor.focus();
    if (this.editorSelectionRange) {
      selection.removeAllRanges();
      selection.addRange(this.editorSelectionRange);
      return true;
    }

    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    this.editorSelectionRange = range.cloneRange();
    return true;
  }

  private captureEditorSelection(editor: HTMLDivElement): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      this.editorSelectionRange = range.cloneRange();
    }
  }

  private applyEditorCommand(
    elementId: string,
    command: 'bold' | 'italic' | 'underline' | 'strikeThrough' | 'subscript' | 'superscript',
    allowCollapsed = false,
  ): boolean {
    return this.applyStyleToSelection(
      elementId,
      () => {
        document.execCommand('styleWithCSS', false, 'true');
        document.execCommand(command);
      },
      allowCollapsed,
    );
  }

  private applyChecklistItemEditorCommand(
    elementId: string,
    itemId: string,
    command: 'bold' | 'italic' | 'underline' | 'strikeThrough' | 'subscript' | 'superscript',
  ): boolean {
    return this.applyChecklistStyleToSelection(
      elementId,
      itemId,
      () => {
        document.execCommand('styleWithCSS', false, 'true');
        document.execCommand(command);
      },
      true,
    );
  }

  private ensureChecklistItemSelection(): void {
    const selectedElement = this.selectedElementId ? this.getElement(this.selectedElementId) : null;
    if (!selectedElement || !isChecklistElement(selectedElement)) {
      this.selectedChecklistItemId = null;
      this.editingChecklistItemId = null;
      return;
    }

    const selectedItem =
      this.selectedChecklistItemId &&
      this.findChecklistItemLocation(selectedElement.id, this.selectedChecklistItemId);
    if (selectedItem) {
      return;
    }

    this.selectedChecklistItemId = selectedElement.items[0]?.id ?? null;
    if (
      this.editingChecklistItemId &&
      !this.findChecklistItemLocation(selectedElement.id, this.editingChecklistItemId)
    ) {
      this.editingChecklistItemId = null;
    }
  }

  private isTextElementById(elementId: string): boolean {
    const element = this.getElement(elementId);
    return element ? isTextElement(element) : false;
  }

  private cloneElement(element: NoteElement): NoteElement {
    if (isChecklistElement(element)) {
      return normalizeChecklistElement({
        ...element,
        items: this.cloneChecklistItems(element.items),
      });
    }

    if (isAttachmentElement(element)) {
      return normalizeAttachmentElement({ ...element });
    }

    return normalizeNoteTextElement({ ...element });
  }

  private pruneDetachedPendingAttachments(): void {
    const referencedAttachmentIds = new Set(
      this.elements
        .filter((element): element is NoteAttachmentElement => isAttachmentElement(element))
        .map((element) => element.attachmentId),
    );
    this.pendingAttachments = this.pendingAttachments.filter(({ attachment }) =>
      referencedAttachmentIds.has(attachment.id),
    );
  }

  private cloneChecklistItems(items: NoteChecklistItem[]): NoteChecklistItem[] {
    return items.map((item) => ({
      ...item,
      children: this.cloneChecklistItems(item.children),
    }));
  }

  private mapChecklistItems(
    items: NoteChecklistItem[],
    itemId: string,
    updater: (item: NoteChecklistItem) => NoteChecklistItem,
  ): NoteChecklistItem[] {
    return items.map((item) =>
      item.id === itemId
        ? updater(item)
        : {
            ...item,
            children: this.mapChecklistItems(item.children, itemId, updater),
          },
    );
  }

  private insertChecklistItemIntoParent(
    items: NoteChecklistItem[],
    parentId: string | null,
    targetIndex: number,
    nextItem: NoteChecklistItem,
  ): NoteChecklistItem[] {
    if (parentId === null) {
      const updated = [...items];
      updated.splice(targetIndex, 0, nextItem);
      return updated;
    }

    return items.map((item) =>
      item.id === parentId
        ? {
            ...item,
            children: this.insertChecklistItemIntoParent(
              item.children,
              null,
              targetIndex,
              nextItem,
            ),
          }
        : {
            ...item,
            children: this.insertChecklistItemIntoParent(
              item.children,
              parentId,
              targetIndex,
              nextItem,
            ),
          },
    );
  }

  private removeChecklistItemFromParent(
    items: NoteChecklistItem[],
    parentId: string | null,
    itemId: string,
  ): NoteChecklistItem[] {
    if (parentId === null) {
      return items.filter((item) => item.id !== itemId);
    }

    return items.map((item) =>
      item.id === parentId
        ? {
            ...item,
            children: item.children.filter((child) => child.id !== itemId),
          }
        : {
            ...item,
            children: this.removeChecklistItemFromParent(item.children, parentId, itemId),
          },
    );
  }

  private pruneEmptyChecklistItems(items: NoteChecklistItem[]): NoteChecklistItem[] {
    return items.flatMap((item) => {
      const children = this.pruneEmptyChecklistItems(item.children);
      if (item.text.trim().length === 0) {
        return children;
      }

      return [
        children === item.children
          ? item
          : {
              ...item,
              children,
            },
      ];
    });
  }

  private findChecklistItemLocation(
    elementId: string,
    itemId: string,
  ): ChecklistItemLocation | null {
    const element = this.getChecklistElement(elementId);
    if (!element) {
      return null;
    }

    return this.findChecklistItemInTree(element.items, itemId);
  }

  private findChecklistItemInTree(
    items: NoteChecklistItem[],
    itemId: string,
    parentId: string | null = null,
    depth = 0,
  ): ChecklistItemLocation | null {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item.id === itemId) {
        return { item, parentId, index, depth };
      }

      const nested = this.findChecklistItemInTree(item.children, itemId, item.id, depth + 1);
      if (nested) {
        return nested;
      }
    }

    return null;
  }

  private getChecklistSiblings(
    items: NoteChecklistItem[],
    parentId: string | null,
  ): NoteChecklistItem[] {
    if (parentId === null) {
      return items;
    }

    for (const item of items) {
      if (item.id === parentId) {
        return item.children;
      }

      const nested = this.getChecklistSiblings(item.children, parentId);
      if (nested.length > 0) {
        return nested;
      }
    }

    return [];
  }

  private moveChecklistItemWithinParent(
    items: NoteChecklistItem[],
    parentId: string | null,
    fromIndex: number,
    toIndex: number,
  ): NoteChecklistItem[] {
    if (parentId === null) {
      return this.moveChecklistItemInList(items, fromIndex, toIndex);
    }

    return items.map((item) =>
      item.id === parentId
        ? {
            ...item,
            children: this.moveChecklistItemInList(item.children, fromIndex, toIndex),
          }
        : {
            ...item,
            children: this.moveChecklistItemWithinParent(
              item.children,
              parentId,
              fromIndex,
              toIndex,
            ),
          },
    );
  }

  private moveChecklistItemInList(
    items: NoteChecklistItem[],
    fromIndex: number,
    toIndex: number,
  ): NoteChecklistItem[] {
    const updated = [...items];
    const [moved] = updated.splice(fromIndex, 1);
    if (!moved) {
      return items;
    }

    updated.splice(toIndex, 0, moved);
    return updated;
  }

  private async loadFontFamilyOptions(): Promise<void> {
    const queryLocalFonts = (window as QueryLocalFontsWindow).queryLocalFonts;
    if (!queryLocalFonts) {
      return;
    }

    try {
      const fonts = await queryLocalFonts();
      const families = [...new Set(fonts.map((font) => font.family).filter(Boolean))].sort(
        (left, right) => left.localeCompare(right),
      );
      if (families.length === 0) {
        return;
      }

      this.fontFamilyOptions = families.map((family) => ({ label: family, value: family }));
      this.changeDetectorRef.detectChanges();
    } catch {
      this.fontFamilyOptions = [
        { label: DEFAULT_TEXT_FONT_FAMILY, value: DEFAULT_TEXT_FONT_FAMILY },
        ...FALLBACK_FONT_FAMILIES.map((family) => ({ label: family, value: family })),
      ];
    }
  }

  private initializeColorUsage(): void {
    this.colorUsage.clear();

    try {
      const stored = localStorage.getItem(COLOR_USAGE_STORAGE_KEY);
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (parsed && typeof parsed === 'object') {
          for (const [color, count] of Object.entries(parsed as Record<string, number>)) {
            if (typeof color === 'string' && typeof count === 'number' && count > 0) {
              this.colorUsage.set(color, count);
            }
          }
        }
      }
    } catch {
      // Ignore malformed stored color usage and rebuild from current elements.
    }

    for (const element of this.elements) {
      if (isTextElement(element) && element.color) {
        this.colorUsage.set(element.color, (this.colorUsage.get(element.color) ?? 0) + 1);
      }
    }

    this.refreshQuickColorOptions();
  }

  private recordColorUsage(color: string): void {
    if (!color) {
      return;
    }

    this.colorUsage.set(color, (this.colorUsage.get(color) ?? 0) + 1);
    try {
      localStorage.setItem(
        COLOR_USAGE_STORAGE_KEY,
        JSON.stringify(Object.fromEntries(this.colorUsage.entries())),
      );
    } catch {
      // Ignore local storage quota or availability issues.
    }
    this.refreshQuickColorOptions();
  }

  private refreshQuickColorOptions(): void {
    const rankedColors = [...this.colorUsage.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([color]) => color);
    this.quickColorOptions = [...new Set([...rankedColors, ...DEFAULT_QUICK_COLORS])].slice(0, 8);
  }

  private initializeCanvasView(): void {
    const rect = this.getSvgHostRect();
    if (!rect) {
      return;
    }

    if (this.note && this.elements.length > 0) {
      this.applyZoomToFitView(rect, this.fitScaleForRect(rect));
      return;
    }

    this.applyDefaultView(rect);
  }

  private applyCenteredView(rect: DOMRect, scale: number): void {
    const bounds = computeNoteContentBounds(this.elements);
    if (!bounds) {
      this.applyDefaultView(rect);
      return;
    }

    this.scale = Math.min(MAX_CANVAS_SCALE, Math.max(MIN_CANVAS_SCALE, scale));
    this.viewX = rect.width / 2 - bounds.centerX * this.scale;
    this.viewY = rect.height / 2 - bounds.centerY * this.scale;
  }

  private applyDefaultView(rect: Pick<DOMRect, 'width' | 'height'>): void {
    this.viewX = rect.width / 2;
    this.viewY = rect.height / 2;
  }

  private applyZoomToFitView(rect: DOMRect, scale: number): void {
    this.applyCenteredView(rect, scale);
  }

  private fitScaleForRect(rect: Pick<DOMRect, 'width' | 'height'>): number {
    const bounds = computeNoteContentBounds(this.elements);
    if (!bounds) {
      return this.scale;
    }

    return Math.min(
      MAX_CANVAS_SCALE,
      Math.max(
        MIN_CANVAS_SCALE,
        Math.min(
          rect.width / Math.max(bounds.width + FIT_CONTENT_PADDING * 2, 1),
          rect.height / Math.max(bounds.height + FIT_CONTENT_PADDING * 2, 1),
        ),
      ),
    );
  }

  private getSvgHostRect(): DOMRect | null {
    return this.svgHostRef?.nativeElement.getBoundingClientRect() ?? null;
  }

  private showPendingNavigationSaveSuccess(): void {
    const message = this.router.getCurrentNavigation()?.extras.state?.['saveSuccessMessage'];
    if (typeof message === 'string' && message) {
      this.showSaveSuccess(message);
    }
  }

  private showSaveSuccess(message: string): void {
    this.clearSaveNotificationTimeout();
    this.saveNotification = {
      type: 'success',
      message,
      dismissable: false,
    };
    this.saveNotificationTimeoutId = window.setTimeout(() => {
      this.saveNotification = null;
      this.saveNotificationTimeoutId = null;
      this.changeDetectorRef.detectChanges();
    }, SAVE_NOTIFICATION_DURATION_MS);
  }

  private showSaveError(message: string): void {
    this.clearSaveNotificationTimeout();
    this.saveNotification = {
      type: 'error',
      message,
      dismissable: true,
    };
  }

  private clearSaveNotificationTimeout(): void {
    if (this.saveNotificationTimeoutId === null) {
      return;
    }

    window.clearTimeout(this.saveNotificationTimeoutId);
    this.saveNotificationTimeoutId = null;
  }

  private pointerToCanvas(
    event:
      | Pick<PointerEvent, 'clientX' | 'clientY'>
      | Pick<WheelEvent, 'clientX' | 'clientY'>
      | Pick<DragEvent, 'clientX' | 'clientY'>,
  ): { x: number; y: number } {
    const rect = this.getSvgHostRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }

    return {
      x: (event.clientX - rect.left - this.viewX) / this.scale,
      y: (event.clientY - rect.top - this.viewY) / this.scale,
    };
  }

  private isFileDrag(event: DragEvent): boolean {
    if (!event.dataTransfer) {
      return false;
    }

    if (event.dataTransfer.files.length > 0) {
      return true;
    }

    return Array.from(event.dataTransfer.types).includes('Files');
  }
}
