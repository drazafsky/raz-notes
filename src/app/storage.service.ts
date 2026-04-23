import { Injectable } from '@angular/core';

import {
  AuthRecord,
  EncryptedPayload,
  base64ToBytes,
  bytesToBase64,
  bytesToUtf8,
  toArrayBuffer,
  utf8ToBytes,
} from './crypto.utils';
import { normalizeNoteTextElement } from './note-svg.utils';

export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
}

export interface NoteTextElement {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height?: number;
  fontSize: number;
}

export interface Note {
  id: number;
  title: string;
  elements: NoteTextElement[];
  createdAt: string;
  lastModifiedAt: string;
  attachments: Attachment[];
}

const INDEX_FILE = 'notes-index.json';
const AUTH_FILE = 'local-auth.json';
const ENCRYPTED_INDEX_FILE = 'notes-vault.json';
const ENCRYPTED_ATTACHMENTS_DIR = 'vault-attachments';
export const LEGACY_STORAGE_KEY = 'raz-notes.notes';

@Injectable({ providedIn: 'root' })
export class StorageService {
  private root: FileSystemDirectoryHandle | null = null;
  private vaultKey: CryptoKey | null = null;

  async init(): Promise<void> {
    await this.getRoot();
  }

  setVaultKey(vaultKey: CryptoKey | null): void {
    this.vaultKey = vaultKey;
  }

  async exportVaultKey(): Promise<ArrayBuffer> {
    return crypto.subtle.exportKey('raw', this.requireVaultKey());
  }

  async readAuthRecord(): Promise<AuthRecord | null> {
    const text = await this.tryReadTextFile(AUTH_FILE);
    if (!text) {
      return null;
    }

    const parsed: unknown = JSON.parse(text);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as AuthRecord).username !== 'string' ||
      typeof (parsed as AuthRecord).normalizedUsername !== 'string'
    ) {
      throw new Error('Stored authentication data is invalid.');
    }

    return parsed as AuthRecord;
  }

  async saveAuthRecord(record: AuthRecord): Promise<void> {
    await this.writeTextFile(AUTH_FILE, JSON.stringify(record));
  }

  async loadNotes(): Promise<Note[]> {
    const encryptedIndex = await this.tryReadTextFile(ENCRYPTED_INDEX_FILE);
    if (encryptedIndex) {
      return this.parseNotes(await this.decryptToString(encryptedIndex));
    }

    const legacyNotes = await this.readLegacyIndex();
    if (legacyNotes.length === 0) {
      return [];
    }

    await this.migrateLegacyNotes(legacyNotes);
    return legacyNotes;
  }

  async saveNotes(notes: Note[]): Promise<void> {
    await this.writeEncryptedTextFile(ENCRYPTED_INDEX_FILE, JSON.stringify(notes));
  }

  async writeAttachment(noteId: number, attachment: Attachment, file: File): Promise<void> {
    const noteDir = await this.getEncryptedNoteDir(noteId, true);
    const fileHandle = await noteDir.getFileHandle(attachment.id, { create: true });
    const writable = await fileHandle.createWritable();
    const payload = await this.encryptBytes(new Uint8Array(await file.arrayBuffer()));
    await writable.write(JSON.stringify(payload));
    await writable.close();
  }

  async readAttachment(noteId: number, attachmentId: string, mimeType: string): Promise<Blob> {
    const noteDir = await this.getEncryptedNoteDir(noteId, false);
    const fileHandle = await noteDir.getFileHandle(attachmentId);
    const file = await fileHandle.getFile();
    const encrypted = await file.text();
    const data = await this.decryptPayload(this.parseEncryptedPayload(encrypted));
    return new Blob([toArrayBuffer(data)], { type: mimeType });
  }

  async deleteAttachment(noteId: number, attachmentId: string): Promise<void> {
    const attachmentsRoot = await this.getEncryptedAttachmentsRoot(false);
    if (!attachmentsRoot) {
      return;
    }

    try {
      const noteDir = await attachmentsRoot.getDirectoryHandle(String(noteId));
      await this.removeEntryIfExists(noteDir, attachmentId, false);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        return;
      }

      throw error;
    }
  }

  async deleteNote(noteId: number): Promise<void> {
    const attachmentsRoot = await this.getEncryptedAttachmentsRoot(false);
    if (attachmentsRoot) {
      await this.removeEntryIfExists(attachmentsRoot, String(noteId), true);
    }

    const root = await this.getRoot();
    await this.removeEntryIfExists(root, String(noteId), true);
  }

  private async migrateLegacyNotes(notes: Note[]): Promise<void> {
    for (const note of notes) {
      for (const attachment of note.attachments) {
        const blob = await this.readLegacyAttachment(note.id, attachment.id, attachment.type);
        const noteDir = await this.getEncryptedNoteDir(note.id, true);
        const fileHandle = await noteDir.getFileHandle(attachment.id, { create: true });
        const writable = await fileHandle.createWritable();
        const payload = await this.encryptBytes(new Uint8Array(await blob.arrayBuffer()));
        await writable.write(JSON.stringify(payload));
        await writable.close();
      }
    }

    await this.saveNotes(notes);

    const root = await this.getRoot();
    await this.removeEntryIfExists(root, INDEX_FILE, false);

    for (const note of notes) {
      await this.removeEntryIfExists(root, String(note.id), true);
    }

    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }

  private async readLegacyIndex(): Promise<Note[]> {
    const root = await this.getRoot();
    try {
      const fileHandle = await root.getFileHandle(INDEX_FILE);
      const file = await fileHandle.getFile();
      const text = await file.text();
      return this.parseNotes(text);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (!legacy) {
          return [];
        }

        return this.parseNotes(legacy);
      }

      throw error;
    }
  }

  private parseNotes(text: string): Note[] {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((note) =>
        this.normalizeNote(note as Partial<Note> & Record<string, unknown>),
      );
    }

    throw new Error('Stored notes data is invalid.');
  }

  private normalizeNote(note: Partial<Note> & Record<string, unknown>): Note {
    return {
      id: note.id as number,
      title: typeof note.title === 'string' ? note.title : 'Untitled note',
      createdAt: note.createdAt as string,
      lastModifiedAt: (note.lastModifiedAt as string | undefined) ?? (note.createdAt as string),
      attachments: Array.isArray(note.attachments) ? (note.attachments as Attachment[]) : [],
      elements: this.normalizeElements(note),
    };
  }

  private normalizeElements(note: Partial<Note> & Record<string, unknown>): NoteTextElement[] {
    if (Array.isArray(note.elements)) {
      return note.elements.map((element, index) =>
        this.normalizeElement(element as unknown as Record<string, unknown>, index),
      );
    }

    return this.migrateLegacyContentToElements(note);
  }

  private normalizeElement(element: Record<string, unknown>, index: number): NoteTextElement {
    return normalizeNoteTextElement({
      id: typeof element['id'] === 'string' ? (element['id'] as string) : `text-${index}`,
      text: typeof element['text'] === 'string' ? (element['text'] as string) : 'New text',
      x: typeof element['x'] === 'number' ? (element['x'] as number) : 0,
      y: typeof element['y'] === 'number' ? (element['y'] as number) : 0,
      width: typeof element['width'] === 'number' ? (element['width'] as number) : undefined,
      height: typeof element['height'] === 'number' ? (element['height'] as number) : undefined,
    });
  }

  private migrateLegacyContentToElements(note: Record<string, unknown>): NoteTextElement[] {
    if (typeof note['text'] === 'string' && note['text'].trim()) {
      return [
        normalizeNoteTextElement({
          id: crypto.randomUUID(),
          text: note['text'].trim(),
          x: 0,
          y: 0,
          width: 280,
        }),
      ];
    }

    if (Array.isArray(note['todos']) && note['todos'].length > 0) {
      return [
        normalizeNoteTextElement({
          id: crypto.randomUUID(),
          text: (note['todos'] as string[]).map((item) => `• ${item}`).join('\n'),
          x: 0,
          y: 0,
          width: 280,
        }),
      ];
    }

    return [];
  }

  private parseEncryptedPayload(text: string): EncryptedPayload {
    const parsed: unknown = JSON.parse(text);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as EncryptedPayload).iv !== 'string' ||
      typeof (parsed as EncryptedPayload).ciphertext !== 'string'
    ) {
      throw new Error('Encrypted note data is invalid.');
    }

    return parsed as EncryptedPayload;
  }

  private async writeEncryptedTextFile(path: string, value: string): Promise<void> {
    await this.writeTextFile(path, JSON.stringify(await this.encryptBytes(utf8ToBytes(value))));
  }

  private async encryptBytes(data: Uint8Array): Promise<EncryptedPayload> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.requireVaultKey(),
      toArrayBuffer(data),
    );

    return {
      version: 1,
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(ciphertext),
    };
  }

  private async decryptToString(text: string): Promise<string> {
    const payload = this.parseEncryptedPayload(text);
    const decrypted = await this.decryptPayload(payload);
    return bytesToUtf8(decrypted);
  }

  private async decryptPayload(payload: EncryptedPayload): Promise<Uint8Array> {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(payload.iv)) },
      this.requireVaultKey(),
      toArrayBuffer(base64ToBytes(payload.ciphertext)),
    );
    return new Uint8Array(plaintext);
  }

  private async readLegacyAttachment(
    noteId: number,
    attachmentId: string,
    mimeType: string,
  ): Promise<Blob> {
    const root = await this.getRoot();
    const noteDir = await root.getDirectoryHandle(String(noteId));
    const fileHandle = await noteDir.getFileHandle(attachmentId);
    const file = await fileHandle.getFile();
    return new Blob([await file.arrayBuffer()], { type: mimeType });
  }

  private async getEncryptedAttachmentsRoot(
    create: boolean,
  ): Promise<FileSystemDirectoryHandle | null> {
    const root = await this.getRoot();
    try {
      return await root.getDirectoryHandle(ENCRYPTED_ATTACHMENTS_DIR, { create });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        return null;
      }

      throw error;
    }
  }

  private async getEncryptedNoteDir(
    noteId: number,
    create: boolean,
  ): Promise<FileSystemDirectoryHandle> {
    const attachmentsRoot = await this.getEncryptedAttachmentsRoot(create);
    if (!attachmentsRoot) {
      throw new Error('Attachment storage is not available.');
    }

    return attachmentsRoot.getDirectoryHandle(String(noteId), { create });
  }

  private async tryReadTextFile(path: string): Promise<string | null> {
    const root = await this.getRoot();
    try {
      const fileHandle = await root.getFileHandle(path);
      const file = await fileHandle.getFile();
      return file.text();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        return null;
      }

      throw error;
    }
  }

  private async writeTextFile(path: string, value: string): Promise<void> {
    const root = await this.getRoot();
    const fileHandle = await root.getFileHandle(path, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(value);
    await writable.close();
  }

  private async removeEntryIfExists(
    dir: FileSystemDirectoryHandle,
    name: string,
    recursive: boolean,
  ): Promise<void> {
    try {
      await dir.removeEntry(name, { recursive });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        return;
      }

      throw error;
    }
  }

  private requireVaultKey(): CryptoKey {
    if (!this.vaultKey) {
      throw new Error('Vault is locked.');
    }

    return this.vaultKey;
  }

  private async getRoot(): Promise<FileSystemDirectoryHandle> {
    if (!this.root) {
      this.root = await navigator.storage.getDirectory();
    }
    return this.root;
  }
}
