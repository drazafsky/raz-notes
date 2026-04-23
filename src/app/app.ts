import { Component, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

type NoteKind = 'text' | 'todo';

interface Note {
  id: number;
  kind: NoteKind;
  title: string;
  text?: string;
  todos?: string[];
  createdAt: string;
}

export const NOTES_STORAGE_KEY = 'raz-notes.notes';

@Component({
  selector: 'app-root',
  imports: [FormsModule, DatePipe],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  readonly notes = signal<Note[]>([]);
  noteKind: NoteKind = 'text';
  noteTitle = '';
  noteText = '';
  todoText = '';

  constructor() {
    this.loadNotes();
  }

  createNote(): void {
    const title = this.noteTitle.trim();
    if (!title) {
      return;
    }

    const baseNote: Note = {
      id: Date.now(),
      kind: this.noteKind,
      title,
      createdAt: new Date().toISOString()
    };

    if (this.noteKind === 'text') {
      const text = this.noteText.trim();
      if (!text) {
        return;
      }

      this.persistNote({ ...baseNote, text });
    } else {
      const todos = this.todoText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      if (todos.length === 0) {
        return;
      }

      this.persistNote({ ...baseNote, todos });
    }

    this.noteTitle = '';
    this.noteText = '';
    this.todoText = '';
    this.noteKind = 'text';
  }

  private persistNote(note: Note): void {
    this.notes.update((currentNotes) => [note, ...currentNotes]);
    this.saveNotes();
  }

  private loadNotes(): void {
    const savedNotes = localStorage.getItem(NOTES_STORAGE_KEY);
    if (!savedNotes) {
      return;
    }

    try {
      const parsed = JSON.parse(savedNotes);
      if (Array.isArray(parsed)) {
        this.notes.set(parsed);
      }
    } catch {
      this.notes.set([]);
    }
  }

  private saveNotes(): void {
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(this.notes()));
  }
}
