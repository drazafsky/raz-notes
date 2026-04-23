import { Injectable } from '@angular/core';

export type NoteKind = 'text' | 'todo';

export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
}

export interface Note {
  id: number;
  kind: NoteKind;
  title: string;
  text?: string;
  todos?: string[];
  createdAt: string;
  attachments: Attachment[];
}

const INDEX_FILE = 'notes-index.json';
export const LEGACY_STORAGE_KEY = 'raz-notes.notes';

@Injectable({ providedIn: 'root' })
export class StorageService {
  private root: FileSystemDirectoryHandle | null = null;

  async init(): Promise<Note[]> {
    this.root = await navigator.storage.getDirectory();
    const notes = await this.readIndex();

    if (notes.length === 0) {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        try {
          const parsed: unknown = JSON.parse(legacy);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const migrated: Note[] = (parsed as Note[]).map((n) => ({
              ...n,
              attachments: n.attachments ?? []
            }));
            await this.saveIndex(migrated);
            localStorage.removeItem(LEGACY_STORAGE_KEY);
            return migrated;
          }
        } catch {
          // ignore malformed data
        }
      }
    }

    return notes;
  }

  async saveIndex(notes: Note[]): Promise<void> {
    const root = this.getRoot();
    const fileHandle = await root.getFileHandle(INDEX_FILE, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(notes));
    await writable.close();
  }

  async writeAttachment(noteId: number, attachment: Attachment, file: File): Promise<void> {
    const root = this.getRoot();
    const noteDir = await root.getDirectoryHandle(String(noteId), { create: true });
    const fileHandle = await noteDir.getFileHandle(attachment.id, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(await file.arrayBuffer());
    await writable.close();
  }

  async readAttachment(noteId: number, attachmentId: string, mimeType: string): Promise<Blob> {
    const root = this.getRoot();
    const noteDir = await root.getDirectoryHandle(String(noteId));
    const fileHandle = await noteDir.getFileHandle(attachmentId);
    const file = await fileHandle.getFile();
    return new Blob([await file.arrayBuffer()], { type: mimeType });
  }

  async deleteNote(noteId: number): Promise<void> {
    const root = this.getRoot();
    try {
      await root.removeEntry(String(noteId), { recursive: true });
    } catch {
      // no attachment directory is fine
    }
  }

  private async readIndex(): Promise<Note[]> {
    const root = this.getRoot();
    try {
      const fileHandle = await root.getFileHandle(INDEX_FILE);
      const file = await fileHandle.getFile();
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return (parsed as Note[]).map((n) => ({
          ...n,
          attachments: n.attachments ?? []
        }));
      }
    } catch {
      // file doesn't exist yet
    }
    return [];
  }

  private getRoot(): FileSystemDirectoryHandle {
    if (!this.root) {
      throw new Error('StorageService not initialized. Call init() first.');
    }
    return this.root;
  }
}
