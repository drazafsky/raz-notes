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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AttachmentViewerComponent } from './attachment-viewer/attachment-viewer.component';
import {
  DEFAULT_TEXT_ELEMENT_WIDTH,
  DEFAULT_TEXT_FONT_SIZE,
  estimateTextElementHeight,
  normalizeNoteTextElement,
} from './note-svg.utils';
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
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly notesState = inject(NotesStateService);

  note: Note | null = null;
  noteError = '';
  isNewNote = false;
  noteTitle = '';
  elements: NoteTextElement[] = [];
  readonly textFontSize = DEFAULT_TEXT_FONT_SIZE;
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

  selectedElement(): NoteTextElement | null {
    return this.selectedElementId ? (this.getElement(this.selectedElementId) ?? null) : null;
  }

  setActiveTool(tool: CanvasTool): void {
    this.activeTool = tool;
    if (tool !== 'selection') {
      this.editingElementId = null;
    }
  }

  updateEditingText(elementId: string, text: string): void {
    this.updateElement(elementId, { text });
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

  onInlineEditorFocus(elementId: string, event: FocusEvent): void {
    if (this.editingElementId !== elementId) {
      return;
    }

    const input = event.target;
    if (!(input instanceof HTMLTextAreaElement)) {
      return;
    }

    this.applyPendingEditorSelection(input);
  }

  stopEditingElement(): void {
    this.editingElementId = null;
    this.pendingEditorSelection = null;
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
      if (input instanceof HTMLTextAreaElement) {
        input.focus();
        this.applyPendingEditorSelection(input);
      }
    });
  }

  private applyPendingEditorSelection(input: HTMLTextAreaElement): void {
    if (this.pendingEditorSelection === null) {
      return;
    }

    const selection = this.pendingEditorSelection;
    const applySelection = () => {
      if (selection === 'all') {
        input.select();
        input.setSelectionRange(0, input.value.length);
      } else {
        input.setSelectionRange(input.value.length, input.value.length);
      }
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
