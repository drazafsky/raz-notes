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
  computeNoteContentBounds,
  DEFAULT_TEXT_ELEMENT_WIDTH,
  DEFAULT_TEXT_FONT_FAMILY,
  DEFAULT_TEXT_FONT_SIZE,
  estimateTextElementHeight,
  normalizeNoteTextElement,
} from './note-svg.utils';
import { plainTextToRichHtml, richHtmlToPlainText } from './rich-text.utils';
import { Note, NoteTextElement } from './storage.service';
import { NotesStateService } from './notes-state.service';

type CanvasTool = 'selection' | 'text';
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
  elements: NoteTextElement[] = [];
  readonly textFontSize = DEFAULT_TEXT_FONT_SIZE;
  readonly defaultTextFontFamily = DEFAULT_TEXT_FONT_FAMILY;
  readonly defaultTextColor = '#111827';
  readonly textToolbarWidth = 760;
  readonly textToolbarHeight = 48;
  readonly fontSizeOptions = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 60, 72, 96];
  fontFamilyOptions: FontOption[] = FALLBACK_FONT_FAMILIES.map((family) => ({
    label: family,
    value: family,
  }));
  quickColorOptions = [...DEFAULT_QUICK_COLORS];
  pendingFiles: File[] = [];
  selectedElementId: string | null = null;
  editingElementId: string | null = null;
  activeTool: CanvasTool = 'selection';
  private pendingEditorSelection: 'all' | 'end' | null = null;
  viewX = 480;
  viewY = 280;
  scale = 1;

  @ViewChild('fileInput') fileInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('svgHost') svgHostRef?: ElementRef<SVGSVGElement>;

  private interactionMode: 'none' | 'canvas' | 'drag' | 'resize' = 'none';
  private interactionMoved = false;
  private activeElementId: string | null = null;
  private pointerStart = { x: 0, y: 0 };
  private viewStart = { x: 0, y: 0 };
  private elementStart = { x: 0, y: 0, width: DEFAULT_TEXT_ELEMENT_WIDTH, height: 0 };
  private editorSelectionRange: Range | null = null;
  private readonly colorUsage = new Map<string, number>();
  private saveNotificationTimeoutId: number | null = null;

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
    this.elements = note.elements.map((element) => ({ ...element }));
    this.selectedElementId = this.elements[0]?.id ?? null;
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
    this.pendingFiles = input.files ? Array.from(input.files) : [];
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
      this.showSaveError('Add at least one text item to the note.');
      return;
    }

    if (this.isNewNote) {
      try {
        const created = await this.notesState.createNote(
          {
            title,
            elements: this.elements,
          },
          this.pendingFiles,
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
      this.note = await this.notesState.updateNote(this.note.id, {
        title,
        elements: this.elements,
      });
      this.showSaveSuccess('Note saved.');
    } catch (error) {
      this.showSaveError(error instanceof Error ? error.message : 'Something went wrong.');
    }
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
    } catch (error) {
      this.noteError = error instanceof Error ? error.message : 'Something went wrong.';
    }
  }

  onCanvasPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }

    this.interactionMode = 'canvas';
    this.interactionMoved = false;
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

    this.selectedElementId = elementId;
    this.activeElementId = elementId;
    this.interactionMode = 'drag';
    this.interactionMoved = false;
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
    this.selectedElementId = elementId;
    this.activeElementId = elementId;
    this.interactionMode = 'resize';
    this.interactionMoved = false;
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

    const element = this.activeElementId ? this.getElement(this.activeElementId) : null;
    if (!element) {
      return;
    }

    if (this.interactionMode === 'drag') {
      this.updateElement(element.id, {
        x: this.elementStart.x + dx / this.scale,
        y: this.elementStart.y + dy / this.scale,
      });
      return;
    }

    this.updateElement(element.id, {
      width: Math.max(100, this.elementStart.width + dx / this.scale),
      height: Math.max(48, this.elementStart.height + dy / this.scale),
    });
  }

  @HostListener('document:pointerup', ['$event'])
  onDocumentPointerUp(event: PointerEvent): void {
    if (this.interactionMode === 'canvas' && !this.interactionMoved) {
      if (this.activeTool === 'text') {
        const point = this.pointerToCanvas(event);
        this.addTextElement(point.x, point.y);
      } else {
        this.selectedElementId = null;
        this.editingElementId = null;
      }
    } else if (
      this.interactionMode === 'drag' &&
      !this.interactionMoved &&
      this.activeTool === 'selection' &&
      this.activeElementId
    ) {
      this.startEditingElement(this.activeElementId);
    }

    this.interactionMode = 'none';
    this.activeElementId = null;
    this.interactionMoved = false;
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeyDown(event: KeyboardEvent): void {
    if (!this.selectedElementId || (event.key !== 'Delete' && event.key !== 'Backspace')) {
      return;
    }

    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
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

  estimateElementHeight(element: NoteTextElement): number {
    return estimateTextElementHeight(element);
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

  selectedElement(): NoteTextElement | null {
    return this.selectedElementId ? (this.getElement(this.selectedElementId) ?? null) : null;
  }

  dismissSaveNotification(): void {
    this.saveNotification = null;
    this.clearSaveNotificationTimeout();
  }

  setActiveTool(tool: CanvasTool): void {
    this.activeTool = tool;
    if (tool !== 'selection') {
      this.editingElementId = null;
      this.editorSelectionRange = null;
    }
  }

  updateEditingText(elementId: string, text: string): void {
    this.updateElement(elementId, { text, richTextHtml: plainTextToRichHtml(text) });
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
      this.updateElement(elementId, patch);
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
      this.updateElement(elementId, { fontSize: nextFontSize });
    }
  }

  toggleTextFormat(elementId: string, format: 'bold' | 'italic' | 'underline'): void {
    const element = this.getElement(elementId);
    if (!element) {
      return;
    }

    switch (format) {
      case 'bold':
        if (!this.applyCommandToSelection(elementId, 'bold')) {
          this.updateElement(elementId, { bold: !element.bold });
        }
        return;
      case 'italic':
        if (!this.applyCommandToSelection(elementId, 'italic')) {
          this.updateElement(elementId, { italic: !element.italic });
        }
        return;
      case 'underline':
        if (!this.applyCommandToSelection(elementId, 'underline')) {
          this.updateElement(elementId, { underline: !element.underline });
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
    if (nextTarget instanceof HTMLElement && nextTarget.closest('[data-text-toolbar="true"]')) {
      return;
    }

    this.editingElementId = null;
    this.pendingEditorSelection = null;
    this.editorSelectionRange = null;
  }

  private updateElement(elementId: string, patch: Partial<NoteTextElement>): void {
    this.elements = this.elements.map((element) =>
      element.id === elementId ? { ...element, ...patch } : element,
    );
    if (this.note) {
      this.note = {
        ...this.note,
        elements: this.elements,
        lastModifiedAt: new Date().toISOString(),
      };
    }
  }

  private deleteElement(elementId: string): void {
    this.elements = this.elements.filter((element) => element.id !== elementId);
    this.selectedElementId = this.elements[0]?.id ?? null;
    if (this.editingElementId === elementId) {
      this.editingElementId = null;
    }
    if (this.note) {
      this.note = {
        ...this.note,
        elements: this.elements,
        lastModifiedAt: new Date().toISOString(),
      };
    }
  }

  private getElement(elementId: string): NoteTextElement | undefined {
    return this.elements.find((element) => element.id === elementId);
  }

  inlineEditorId(elementId: string): string {
    return `text-editor-${elementId}`;
  }

  @HostListener('document:selectionchange')
  onDocumentSelectionChange(): void {
    if (!this.editingElementId) {
      return;
    }

    const editor = this.getInlineEditorElement(this.editingElementId);
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
    if (!this.getElement(elementId)) {
      return;
    }

    this.selectedElementId = elementId;
    this.editingElementId = elementId;
    this.pendingEditorSelection = selection;
    queueMicrotask(() => {
      this.changeDetectorRef.detectChanges();
      const input = document.getElementById(this.inlineEditorId(elementId));
      if (input instanceof HTMLDivElement) {
        const element = this.getElement(elementId);
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
    this.updateElement(elementId, {
      text: richHtmlToPlainText(editor.innerHTML),
      richTextHtml: editor.innerHTML,
    });
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
    const editor = this.getInlineEditorElement(elementId);
    if (!editor || !this.restoreEditorSelection(editor)) {
      return false;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || (!allowCollapsed && selection.isCollapsed)) {
      return false;
    }

    applySelectionCommand(editor);
    this.syncElementFromEditor(elementId, editor);
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
      if (element.color) {
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

  private pointerToCanvas(event: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.getSvgHostRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }

    return {
      x: (event.clientX - rect.left - this.viewX) / this.scale,
      y: (event.clientY - rect.top - this.viewY) / this.scale,
    };
  }
}
