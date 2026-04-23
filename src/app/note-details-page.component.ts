import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AttachmentViewerComponent } from './attachment-viewer/attachment-viewer.component';
import { Note, NoteKind } from './storage.service';
import { NotesStateService } from './notes-state.service';

@Component({
  selector: 'app-note-details-page',
  imports: [FormsModule, DatePipe, RouterLink, AttachmentViewerComponent],
  templateUrl: './note-details-page.component.html'
})
export class NoteDetailsPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly notesState = inject(NotesStateService);

  note: Note | null = null;
  noteError = '';
  isNewNote = false;
  noteKind: NoteKind = 'text';
  noteTitle = '';
  noteText = '';
  todoText = '';
  pendingFiles: File[] = [];

  @ViewChild('fileInput') fileInputRef?: ElementRef<HTMLInputElement>;

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
    this.noteKind = note.kind;
    this.noteTitle = note.title;
    this.noteText = note.text ?? '';
    this.todoText = note.todos?.join('\n') ?? '';
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

    if (this.noteKind === 'text') {
      const text = this.noteText.trim();
      if (!text) {
        this.noteError = 'Text is required for plain text notes.';
        return;
      }
    } else {
      const todos = this.todoItems();
      if (todos.length === 0) {
        this.noteError = 'Add at least one todo item.';
        return;
      }
    }

    if (this.isNewNote) {
      const created = await this.notesState.createNote(
        {
          kind: this.noteKind,
          title,
          text: this.noteKind === 'text' ? this.noteText : undefined,
          todos: this.noteKind === 'todo' ? this.todoItems() : undefined
        },
        this.pendingFiles
      );
      void this.router.navigate(['/notes', created.id]);
      return;
    }

    if (!this.note) {
      this.noteError = 'Note not found.';
      return;
    }

    this.note = await this.notesState.updateNote(this.note.id, {
      kind: this.noteKind,
      title,
      text: this.noteKind === 'text' ? this.noteText : undefined,
      todos: this.noteKind === 'todo' ? this.todoItems() : undefined
    });
  }

  async deleteNote(): Promise<void> {
    if (!this.note) {
      return;
    }

    await this.notesState.deleteNote(this.note.id);
    void this.router.navigate(['/notes']);
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private todoItems(): string[] {
    return this.todoText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
}
