import { Injectable, computed, signal } from '@angular/core';

import { Note, NoteKind, StorageService } from './storage.service';

export interface NoteInput {
  kind: NoteKind;
  title: string;
  text?: string;
  todos?: string[];
}

@Injectable({ providedIn: 'root' })
export class NotesStateService {
  readonly notes = signal<Note[]>([]);
  readonly notesByUpdatedAt = computed(() =>
    [...this.notes()].sort((left, right) => right.lastModifiedAt.localeCompare(left.lastModifiedAt))
  );
  readonly notesByTitle = computed(() =>
    [...this.notes()].sort((left, right) => left.title.localeCompare(right.title))
  );

  constructor(private readonly storage: StorageService) {}

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
      kind: input.kind,
      title: input.title.trim(),
      createdAt: now,
      lastModifiedAt: now,
      attachments: files.map((file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type,
        size: file.size
      })),
      ...(input.kind === 'text'
        ? { text: input.text?.trim() ?? '' }
        : { todos: input.todos ?? [] })
    };

    const updatedNotes = [note, ...this.notes()];
    this.notes.set(updatedNotes);
    await this.storage.saveNotes(updatedNotes);

    for (let i = 0; i < files.length; i++) {
      await this.storage.writeAttachment(note.id, note.attachments[i], files[i]);
    }

    return note;
  }

  async updateNote(noteId: number, input: NoteInput): Promise<Note> {
    const existing = this.requireNote(noteId);
    const updatedNote: Note = {
      id: existing.id,
      kind: input.kind,
      title: input.title.trim(),
      createdAt: existing.createdAt,
      lastModifiedAt: new Date().toISOString(),
      attachments: existing.attachments,
      ...(input.kind === 'text'
        ? { text: input.text?.trim() ?? '' }
        : { todos: input.todos ?? [] })
    };

    const updatedNotes = this.notes().map((note) => (note.id === noteId ? updatedNote : note));
    this.notes.set(updatedNotes);
    await this.storage.saveNotes(updatedNotes);
    return updatedNote;
  }

  async deleteNote(noteId: number): Promise<void> {
    await this.storage.deleteNote(noteId);
    const updatedNotes = this.notes().filter((note) => note.id !== noteId);
    this.notes.set(updatedNotes);
    await this.storage.saveNotes(updatedNotes);
  }

  private requireNote(noteId: number): Note {
    const note = this.getNote(noteId);
    if (!note) {
      throw new Error('Note not found.');
    }

    return note;
  }
}
