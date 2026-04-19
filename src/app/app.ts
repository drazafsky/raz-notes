import { Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Note, NoteKind, StorageService } from './storage.service';
import { AttachmentViewerComponent } from './attachment-viewer/attachment-viewer.component';

@Component({
  selector: 'app-root',
  imports: [FormsModule, DatePipe, AttachmentViewerComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  private readonly storage = inject(StorageService);

  readonly notes = signal<Note[]>([]);
  noteKind: NoteKind = 'text';
  noteTitle = '';
  noteText = '';
  todoText = '';
  pendingFiles: File[] = [];

  @ViewChild('fileInput') fileInputRef?: ElementRef<HTMLInputElement>;

  constructor() {
    this.storage.init().then((notes) => this.notes.set(notes));
  }

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.pendingFiles = input.files ? Array.from(input.files) : [];
  }

  async createNote(): Promise<void> {
    const title = this.noteTitle.trim();
    if (!title) {
      return;
    }

    const baseNote = {
      id: Date.now(),
      kind: this.noteKind,
      title,
      createdAt: new Date().toISOString(),
      attachments: this.pendingFiles.map((file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type,
        size: file.size
      }))
    };

    let note: Note;
    if (this.noteKind === 'text') {
      const text = this.noteText.trim();
      if (!text) {
        return;
      }
      note = { ...baseNote, text };
    } else {
      const todos = this.todoText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      if (todos.length === 0) {
        return;
      }
      note = { ...baseNote, todos };
    }

    const updatedNotes = [note, ...this.notes()];
    this.notes.set(updatedNotes);
    await this.storage.saveIndex(updatedNotes);

    for (let i = 0; i < this.pendingFiles.length; i++) {
      await this.storage.writeAttachment(note.id, note.attachments[i], this.pendingFiles[i]);
    }

    this.noteTitle = '';
    this.noteText = '';
    this.todoText = '';
    this.noteKind = 'text';
    this.pendingFiles = [];
    if (this.fileInputRef) {
      this.fileInputRef.nativeElement.value = '';
    }
  }

  async deleteNote(noteId: number): Promise<void> {
    await this.storage.deleteNote(noteId);
    const updated = this.notes().filter((n) => n.id !== noteId);
    this.notes.set(updated);
    await this.storage.saveIndex(updated);
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
