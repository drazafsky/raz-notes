import { Injectable, computed, inject, signal } from '@angular/core';

import { AuthService } from './auth.service';
import { NoteArchiveService } from './note-archive.service';
import {
  isAttachmentElement,
  isChecklistElement,
  normalizeAttachmentElement,
  normalizeChecklistElement,
  normalizeNoteTextElement,
} from './note-svg.utils';
import { Attachment, Note, NoteElement, StorageService } from './storage.service';

export interface NoteInput {
  title: string;
  elements: NoteElement[];
}

export interface PendingAttachment {
  attachment: Attachment;
  file: File;
}

export type ImportedNoteCollisionStrategy = 'replace' | 'rename';

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
  private readonly noteArchive = inject(NoteArchiveService);
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

  getNoteByTitle(title: string): Note | undefined {
    return this.notes().find((note) => note.title === title);
  }

  async inspectImportArchive(file: File): Promise<{ title: string }> {
    return this.noteArchive.inspectArchive(file);
  }

  async exportNoteArchive(noteId: number): Promise<{ blob: Blob; fileName: string }> {
    const note = this.requireNote(noteId);
    const attachments = new Map<string, Blob>();

    for (const attachment of note.attachments) {
      attachments.set(
        attachment.id,
        await this.storage.readAttachment(note.id, attachment.id, attachment.type),
      );
    }

    return {
      blob: await this.noteArchive.exportNote(note, attachments),
      fileName: `${this.sanitizeFileName(note.title)}.mrn`,
    };
  }

  async importNoteArchive(
    file: File,
    collisionStrategy: ImportedNoteCollisionStrategy,
  ): Promise<Note> {
    const archive = await this.noteArchive.importNote(file);
    const existing = this.getNoteByTitle(archive.note.title);

    if (collisionStrategy === 'replace' && existing) {
      return this.replaceImportedNote(existing, archive.note, archive.attachmentFiles);
    }

    return this.createImportedNote(
      {
        ...archive.note,
        title:
          collisionStrategy === 'rename' && existing
            ? `${archive.note.title} - Import`
            : archive.note.title,
      },
      archive.attachmentFiles,
    );
  }

  async createNote(input: NoteInput, pendingAttachments: PendingAttachment[]): Promise<Note> {
    const now = new Date().toISOString();
    const referencedAttachmentIds = this.collectAttachmentElementIds(input.elements);
    const usedPendingAttachments = pendingAttachments.filter(({ attachment }) =>
      referencedAttachmentIds.has(attachment.id),
    );
    const note: Note = {
      id: Date.now(),
      title: input.title.trim(),
      createdAt: now,
      lastModifiedAt: now,
      elements: input.elements.map((element) => this.normalizeElement(element)),
      attachments: usedPendingAttachments.map(({ attachment }) => ({ ...attachment })),
    };

    const updatedNotes = [note, ...this.notes()];
    this.notes.set(updatedNotes);
    await this.storage.saveNotes(updatedNotes);

    for (const pendingAttachment of usedPendingAttachments) {
      await this.storage.writeAttachment(
        note.id,
        pendingAttachment.attachment,
        pendingAttachment.file,
      );
    }

    this.auth.recordActivity();
    return note;
  }

  async updateNote(
    noteId: number,
    input: NoteInput,
    pendingAttachments: PendingAttachment[] = [],
  ): Promise<Note> {
    const existing = this.requireNote(noteId);
    const referencedAttachmentIds = this.collectAttachmentElementIds(input.elements);
    const previouslyReferencedAttachmentIds = this.collectAttachmentElementIds(existing.elements);
    const retainedExistingAttachments = existing.attachments.filter(
      (attachment) =>
        referencedAttachmentIds.has(attachment.id) ||
        !previouslyReferencedAttachmentIds.has(attachment.id),
    );
    const usedPendingAttachments = pendingAttachments.filter(({ attachment }) =>
      referencedAttachmentIds.has(attachment.id),
    );
    const deletedAttachments = existing.attachments.filter(
      (attachment) =>
        !retainedExistingAttachments.some((candidate) => candidate.id === attachment.id),
    );
    const updatedNote: Note = {
      id: existing.id,
      title: input.title.trim(),
      createdAt: existing.createdAt,
      lastModifiedAt: new Date().toISOString(),
      attachments: [
        ...retainedExistingAttachments.map((attachment) => ({ ...attachment })),
        ...usedPendingAttachments.map(({ attachment }) => ({ ...attachment })),
      ],
      elements: input.elements.map((element) => this.normalizeElement(element)),
    };

    const updatedNotes = this.notes().map((note) => (note.id === noteId ? updatedNote : note));
    this.notes.set(updatedNotes);
    await this.storage.saveNotes(updatedNotes);
    for (const attachment of usedPendingAttachments) {
      await this.storage.writeAttachment(noteId, attachment.attachment, attachment.file);
    }
    for (const attachment of deletedAttachments) {
      await this.storage.deleteAttachment(noteId, attachment.id);
    }
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

  private normalizeElement(element: NoteElement): NoteElement {
    if (isAttachmentElement(element)) {
      return normalizeAttachmentElement(element);
    }

    return isChecklistElement(element)
      ? normalizeChecklistElement(element)
      : normalizeNoteTextElement(element);
  }

  private collectAttachmentElementIds(elements: NoteElement[]): Set<string> {
    return new Set(
      elements
        .filter(isAttachmentElement)
        .map((element) => element.attachmentId)
        .filter(Boolean),
    );
  }

  private async replaceImportedNote(
    existing: Note,
    importedNote: Omit<Note, 'id'>,
    attachmentFiles: { attachmentId: string; file: File }[],
  ): Promise<Note> {
    await this.storage.deleteNote(existing.id);
    return this.persistImportedNote(existing.id, importedNote, attachmentFiles, existing.id);
  }

  private async createImportedNote(
    importedNote: Omit<Note, 'id'>,
    attachmentFiles: { attachmentId: string; file: File }[],
  ): Promise<Note> {
    return this.persistImportedNote(Date.now(), importedNote, attachmentFiles);
  }

  private async persistImportedNote(
    noteId: number,
    importedNote: Omit<Note, 'id'>,
    attachmentFiles: { attachmentId: string; file: File }[],
    replacingNoteId?: number,
  ): Promise<Note> {
    const attachmentFilesById = new Map(
      attachmentFiles.map((entry) => [entry.attachmentId, entry.file]),
    );
    const normalizedNote: Note = {
      id: noteId,
      title: importedNote.title.trim() || 'Untitled note',
      createdAt: importedNote.createdAt,
      lastModifiedAt: importedNote.lastModifiedAt,
      elements: importedNote.elements.map((element) => this.normalizeElement(element)),
      attachments: importedNote.attachments.map((attachment) => ({ ...attachment })),
    };

    const remainingNotes = this.notes().filter((note) => note.id !== (replacingNoteId ?? -1));
    const updatedNotes = [normalizedNote, ...remainingNotes];
    this.notes.set(updatedNotes);
    await this.storage.saveNotes(updatedNotes);

    for (const attachment of normalizedNote.attachments) {
      const file = attachmentFilesById.get(attachment.id);
      if (!file) {
        throw new Error(`Imported attachment bytes are missing for "${attachment.name}".`);
      }
      await this.storage.writeAttachment(
        normalizedNote.id,
        attachment,
        new File([file], attachment.name, { type: attachment.type }),
      );
    }

    this.auth.recordActivity();
    return normalizedNote;
  }

  private sanitizeFileName(title: string): string {
    const trimmed = title.trim() || 'note';
    return trimmed
      .replace(/[<>:"/\\|?*]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
