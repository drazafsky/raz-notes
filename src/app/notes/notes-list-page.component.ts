import { Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';

import { AttachmentViewerComponent } from './attachment-viewer/attachment-viewer.component';
import { ConfirmationModalComponent } from './confirmation-modal.component';
import {
  ChecklistLayoutRow,
  computeNoteViewBox,
  DEFAULT_TEXT_FONT_FAMILY,
  estimateNoteElementHeight,
  isAttachmentElement,
  isChecklistElement,
  isTextElement,
  layoutChecklistRows,
} from './note-svg.utils';
import { plainTextToRichHtml } from './rich-text.utils';
import { AuthService } from '../auth/auth.service';
import { NotesStateService } from './notes-state.service';
import {
  Attachment,
  Note,
  NoteAttachmentElement,
  NoteChecklistElement,
  NoteChecklistItem,
  NoteElement,
  NoteTextElement,
} from './storage.service';

@Component({
  selector: 'app-notes-list-page',
  imports: [DatePipe, RouterLink, AttachmentViewerComponent, ConfirmationModalComponent],
  templateUrl: './notes-list-page.component.html',
})
export class NotesListPageComponent {
  readonly auth = inject(AuthService);
  readonly notesState = inject(NotesStateService);
  private readonly sanitizer = inject(DomSanitizer);
  readonly defaultTextFontFamily = DEFAULT_TEXT_FONT_FAMILY;
  passwordlessError = '';
  noteActionError = '';
  pendingDeleteNoteId: number | null = null;
  pendingDeleteNoteTitle = '';

  async exportNote(noteId: number): Promise<void> {
    this.noteActionError = '';
    try {
      const archive = await this.notesState.exportNoteArchive(noteId);
      this.downloadArchive(archive.blob, archive.fileName);
    } catch (error) {
      this.noteActionError = error instanceof Error ? error.message : 'Something went wrong.';
    }
  }

  async importNote(event: Event): Promise<void> {
    this.noteActionError = '';
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }

    try {
      const archive = await this.notesState.inspectImportArchive(file);
      const existing = this.notesState.getNoteByTitle(archive.title);
      const collisionStrategy =
        existing && window.confirm(`A note named "${archive.title}" already exists. Replace it?`)
          ? 'replace'
          : 'rename';

      await this.notesState.importNoteArchive(file, collisionStrategy);
    } catch (error) {
      this.noteActionError = error instanceof Error ? error.message : 'Something went wrong.';
    }
  }

  async enablePasswordlessUnlock(): Promise<void> {
    this.passwordlessError = '';
    try {
      await this.auth.enablePasswordlessUnlock();
    } catch (error) {
      this.passwordlessError = error instanceof Error ? error.message : 'Something went wrong.';
    }
  }

  async disablePasswordlessUnlock(): Promise<void> {
    this.passwordlessError = '';
    try {
      await this.auth.disablePasswordlessUnlock();
    } catch (error) {
      this.passwordlessError = error instanceof Error ? error.message : 'Something went wrong.';
    }
  }

  requestDeleteNote(note: Note): void {
    this.noteActionError = '';
    this.pendingDeleteNoteId = note.id;
    this.pendingDeleteNoteTitle = note.title;
  }

  cancelDeleteNote(): void {
    this.pendingDeleteNoteId = null;
    this.pendingDeleteNoteTitle = '';
  }

  pendingDeleteMessage(): string {
    return `Delete "${this.pendingDeleteNoteTitle}"? This cannot be undone.`;
  }

  async confirmDeleteNote(): Promise<void> {
    if (this.pendingDeleteNoteId === null) {
      return;
    }

    this.noteActionError = '';

    try {
      await this.notesState.deleteNote(this.pendingDeleteNoteId);
      this.cancelDeleteNote();
    } catch (error) {
      this.noteActionError = error instanceof Error ? error.message : 'Something went wrong.';
    }
  }

  previewViewBox(note: Note): string {
    return computeNoteViewBox(note.elements);
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

  isTextElement(element: NoteElement): element is NoteTextElement {
    return isTextElement(element);
  }

  isChecklistElement(element: NoteElement): element is NoteChecklistElement {
    return isChecklistElement(element);
  }

  isAttachmentElement(element: NoteElement): element is NoteAttachmentElement {
    return isAttachmentElement(element);
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

  checklistStateSymbol(state: NoteChecklistItem['state']): string {
    switch (state) {
      case 'checked':
        return '☑';
      case 'partial':
        return '◩';
      default:
        return '☐';
    }
  }

  attachmentForElement(note: Note, element: NoteAttachmentElement): Attachment | null {
    return note.attachments.find((attachment) => attachment.id === element.attachmentId) ?? null;
  }

  private downloadArchive(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }
}
