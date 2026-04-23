import { Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';

import { AttachmentViewerComponent } from './attachment-viewer/attachment-viewer.component';
import {
  computeNoteViewBox,
  DEFAULT_TEXT_FONT_FAMILY,
  estimateTextElementHeight,
} from './note-svg.utils';
import { plainTextToRichHtml } from './rich-text.utils';
import { AuthService } from './auth.service';
import { NotesStateService } from './notes-state.service';
import { Note, NoteTextElement } from './storage.service';

@Component({
  selector: 'app-notes-list-page',
  imports: [DatePipe, RouterLink, AttachmentViewerComponent],
  templateUrl: './notes-list-page.component.html',
})
export class NotesListPageComponent {
  readonly auth = inject(AuthService);
  readonly notesState = inject(NotesStateService);
  private readonly sanitizer = inject(DomSanitizer);
  readonly defaultTextFontFamily = DEFAULT_TEXT_FONT_FAMILY;
  passwordlessError = '';
  noteActionError = '';

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

  async deleteNote(noteId: number): Promise<void> {
    this.noteActionError = '';

    try {
      await this.notesState.deleteNote(noteId);
    } catch (error) {
      this.noteActionError = error instanceof Error ? error.message : 'Something went wrong.';
    }
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  previewViewBox(note: Note): string {
    return computeNoteViewBox(note.elements);
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
}
