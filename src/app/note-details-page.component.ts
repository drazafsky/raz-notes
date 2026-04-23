import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  inject,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AttachmentViewerComponent } from './attachment-viewer/attachment-viewer.component';
import {
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

@Component({
  selector: 'app-note-details-page',
  imports: [FormsModule, DatePipe, RouterLink, AttachmentViewerComponent],
  templateUrl: './note-details-page.component.html',
})
export class NoteDetailsPageComponent implements AfterViewInit {
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly notesState = inject(NotesStateService);

  note: Note | null = null;
  noteError = '';
  isNewNote = false;
  noteTitle = '';
  elements: NoteTextElement[] = [];
  readonly textFontSize = DEFAULT_TEXT_FONT_SIZE;
  readonly defaultTextFontFamily = DEFAULT_TEXT_FONT_FAMILY;
  readonly defaultTextColor = '#111827';
  readonly textToolbarWidth = 420;
  readonly textToolbarHeight = 48;
  readonly fontSizeOptions = [16, 20, 24, 32, 40, 48];
  readonly fontFamilyOptions = [
    { label: 'Sans', value: DEFAULT_TEXT_FONT_FAMILY },
    { label: 'Serif', value: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif' },
    {
      label: 'Mono',
      value:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    },
  ];
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

  constructor() {
    const routeId = this.route.snapshot.paramMap.get('id');
    this.isNewNote = routeId === null;

    if (!routeId) {
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
  }

  ngAfterViewInit(): void {
    queueMicrotask(() => {
      const rect = this.svgHostRef?.nativeElement.getBoundingClientRect();
      if (!rect) {
        return;
      }

      this.viewX = rect.width / 2;
      this.viewY = rect.height / 2;
      this.changeDetectorRef.detectChanges();
    });
  }

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.pendingFiles = input.files ? Array.from(input.files) : [];
  }

  async saveNote(): Promise<void> {
    this.noteError = '';
    const title = this.noteTitle.trim();
    if (!title) {
      this.noteError = 'Title is required.';
      return;
    }
    if (this.elements.length === 0) {
      this.noteError = 'Add at least one text item to the note.';
      return;
    }

    if (this.isNewNote) {
      const created = await this.notesState.createNote(
        {
          title,
          elements: this.elements,
        },
        this.pendingFiles,
      );
      void this.router.navigate(['/notes', created.id]);
      return;
    }

    if (!this.note) {
      this.noteError = 'Note not found.';
      return;
    }

    this.note = await this.notesState.updateNote(this.note.id, {
      title,
      elements: this.elements,
    });
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
    const nextScale = Math.min(6, Math.max(0.25, this.scale * (event.deltaY < 0 ? 1.1 : 0.9)));
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

  textToolbarY(element: NoteTextElement): number {
    return element.y - this.fontSizeFor(element) - this.textToolbarHeight - 18;
  }

  selectedElement(): NoteTextElement | null {
    return this.selectedElementId ? (this.getElement(this.selectedElementId) ?? null) : null;
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
    return this.applyStyleToSelection(elementId, () => {
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand(command);
    });
  }

  private applyStyleToSelection(
    elementId: string,
    applySelectionCommand: (editor: HTMLDivElement) => void,
  ): boolean {
    const editor = this.getInlineEditorElement(elementId);
    if (!editor || !this.restoreEditorSelection(editor)) {
      return false;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
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

  private pointerToCanvas(event: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.svgHostRef?.nativeElement.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }

    return {
      x: (event.clientX - rect.left - this.viewX) / this.scale,
      y: (event.clientY - rect.top - this.viewY) / this.scale,
    };
  }
}
