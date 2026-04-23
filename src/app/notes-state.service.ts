import { Injectable, computed, inject, signal } from '@angular/core';

import { AuthService } from './auth.service';
import { normalizeNoteTextElement } from './note-svg.utils';
import { Note, NoteTextElement, StorageService } from './storage.service';

export interface NoteInput {
  title: string;
  elements: NoteTextElement[];
}

@Injectable({ providedIn: 'root' })
export class NotesStateService {
  readonly notes = signal<Note[]>([]);
  readonly notesByUpdatedAt = computed(() =>
    [...this.notes()].sort((left, right) =>
      right.lastModifiedAt.localeCompare(left.lastModifiedAt),
    ),
  );
  readonly notesByTitle = computed(() =>
    [...this.notes()].sort((left, right) => left.title.localeCompare(right.title)),
  );

  private readonly auth = inject(AuthService);
  private readonly storage = inject(StorageService);

  async load(): Promise<void> {
    this.notes.set(await this.storage.loadNotes());
  }

  clear(): void {
    this.notes.set([]);
  }

  getNote(noteId: number): Note | undefined {
    return this.notes().find((note) => note.id === noteId);
  }

  async createNote(input: NoteInput, files: File[]): Promise<Note> {
    const now = new Date().toISOString();
    const note: Note = {
      id: Date.now(),
      title: input.title.trim(),
      createdAt: now,
      lastModifiedAt: now,
      elements: input.elements.map((element) => this.normalizeElement(element)),
      attachments: files.map((file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type,
        size: file.size,
      })),
    };

    const updatedNotes = [note, ...this.notes()];
    this.notes.set(updatedNotes);
    await this.storage.saveNotes(updatedNotes);

    for (let i = 0; i < files.length; i++) {
      await this.storage.writeAttachment(note.id, note.attachments[i], files[i]);
    }

    this.auth.recordActivity();
    return note;
  }

  async updateNote(noteId: number, input: NoteInput): Promise<Note> {
    const existing = this.requireNote(noteId);
    const updatedNote: Note = {
      id: existing.id,
      title: input.title.trim(),
      createdAt: existing.createdAt,
      lastModifiedAt: new Date().toISOString(),
      attachments: existing.attachments,
      elements: input.elements.map((element) => this.normalizeElement(element)),
    };

    const updatedNotes = this.notes().map((note) => (note.id === noteId ? updatedNote : note));
    this.notes.set(updatedNotes);
    await this.storage.saveNotes(updatedNotes);
    this.auth.recordActivity();
    return updatedNote;
  }

  async deleteNote(noteId: number): Promise<void> {
    await this.storage.deleteNote(noteId);
    const updatedNotes = this.notes().filter((note) => note.id !== noteId);
    this.notes.set(updatedNotes);
    await this.storage.saveNotes(updatedNotes);
    this.auth.recordActivity();
  }

  async deleteAttachment(noteId: number, attachmentId: string): Promise<Note> {
    const existing = this.requireNote(noteId);
    const attachmentExists = existing.attachments.some(
      (attachment) => attachment.id === attachmentId,
    );
    if (!attachmentExists) {
      throw new Error('Attachment not found.');
    }

    await this.storage.deleteAttachment(noteId, attachmentId);
    const updatedNote: Note = {
      ...existing,
      attachments: existing.attachments.filter((attachment) => attachment.id !== attachmentId),
      lastModifiedAt: new Date().toISOString(),
    };
    const updatedNotes = this.notes().map((note) => (note.id === noteId ? updatedNote : note));
    this.notes.set(updatedNotes);
    await this.storage.saveNotes(updatedNotes);
    this.auth.recordActivity();
    return updatedNote;
  }

  private requireNote(noteId: number): Note {
    const note = this.getNote(noteId);
    if (!note) {
      throw new Error('Note not found.');
    }

    return note;
  }

  private normalizeElement(element: NoteTextElement): NoteTextElement {
    return normalizeNoteTextElement(element);
  }
}
