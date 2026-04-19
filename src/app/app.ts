import { Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { AttachmentViewerComponent } from './attachment-viewer/attachment-viewer.component';
import { AuthService } from './auth.service';
import { Note, NoteKind, StorageService } from './storage.service';

@Component({
  selector: 'app-root',
  imports: [FormsModule, DatePipe, AttachmentViewerComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  readonly auth = inject(AuthService);
  private readonly storage = inject(StorageService);

  readonly notes = signal<Note[]>([]);
  authError = '';
  noteError = '';
  setupUsername = '';
  setupPassword = '';
  setupPasswordConfirm = '';
  loginUsername = '';
  loginPassword = '';
  noteKind: NoteKind = 'text';
  noteTitle = '';
  noteText = '';
  todoText = '';
  pendingFiles: File[] = [];

  @ViewChild('fileInput') fileInputRef?: ElementRef<HTMLInputElement>;

  constructor() {
    void this.auth.init();
  }

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.pendingFiles = input.files ? Array.from(input.files) : [];
  }

  async setupAccount(): Promise<void> {
    this.authError = '';

    if (this.setupPassword !== this.setupPasswordConfirm) {
      this.authError = 'Passwords do not match.';
      return;
    }

    try {
      await this.auth.createAccount(this.setupUsername, this.setupPassword);
      this.loginUsername = this.setupUsername.trim();
      this.setupUsername = '';
      this.setupPassword = '';
      this.setupPasswordConfirm = '';
      await this.loadNotes();
    } catch (error) {
      this.auth.logout();
      this.authError = this.errorMessage(error);
    }
  }

  async login(): Promise<void> {
    this.authError = '';

    try {
      await this.auth.login(this.loginUsername, this.loginPassword);
      await this.loadNotes();
      this.loginPassword = '';
    } catch (error) {
      this.notes.set([]);
      if (this.auth.isUnlocked()) {
        this.auth.logout();
      }
      this.authError = this.errorMessage(error);
    }
  }

  async loginWithDevice(): Promise<void> {
    this.authError = '';

    try {
      await this.auth.loginWithDevice();
      await this.loadNotes();
      this.loginPassword = '';
    } catch (error) {
      this.notes.set([]);
      if (this.auth.isUnlocked()) {
        this.auth.logout();
      }
      this.authError = this.errorMessage(error);
    }
  }

  async enablePasswordlessUnlock(): Promise<void> {
    this.authError = '';

    try {
      await this.auth.enablePasswordlessUnlock();
    } catch (error) {
      this.authError = this.errorMessage(error);
    }
  }

  async disablePasswordlessUnlock(): Promise<void> {
    this.authError = '';

    try {
      await this.auth.disablePasswordlessUnlock();
    } catch (error) {
      this.authError = this.errorMessage(error);
    }
  }

  logout(): void {
    this.auth.logout();
    this.notes.set([]);
    this.noteError = '';
    this.pendingFiles = [];
    this.loginPassword = '';
    if (this.fileInputRef) {
      this.fileInputRef.nativeElement.value = '';
    }
  }

  async createNote(): Promise<void> {
    this.noteError = '';
    const title = this.noteTitle.trim();
    if (!title) {
      this.noteError = 'Title is required.';
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
        this.noteError = 'Text is required for plain text notes.';
        return;
      }
      note = { ...baseNote, text };
    } else {
      const todos = this.todoText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      if (todos.length === 0) {
        this.noteError = 'Add at least one todo item.';
        return;
      }
      note = { ...baseNote, todos };
    }

    const updatedNotes = [note, ...this.notes()];
    this.notes.set(updatedNotes);
    await this.storage.saveNotes(updatedNotes);

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
    await this.storage.saveNotes(updated);
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private async loadNotes(): Promise<void> {
    this.notes.set(await this.storage.loadNotes());
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Something went wrong.';
  }
}
