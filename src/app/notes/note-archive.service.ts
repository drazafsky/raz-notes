import { Injectable } from '@angular/core';
import JSZip from 'jszip';

import {
  normalizeAttachmentElement,
  normalizeChecklistElement,
  normalizeNoteTextElement,
} from './note-svg.utils';
import { Attachment, Note, NoteElement } from './storage.service';

export interface NoteArchiveManifest {
  format: 'mrn';
  version: 1;
  exportedAt: string;
  note: {
    title: string;
    createdAt: string;
    lastModifiedAt: string;
    elements: NoteElement[];
    attachments: Attachment[];
  };
}

export interface ImportedNoteArchive {
  note: {
    title: string;
    createdAt: string;
    lastModifiedAt: string;
    elements: NoteElement[];
    attachments: Attachment[];
  };
  attachmentFiles: { attachmentId: string; file: File }[];
}

@Injectable({ providedIn: 'root' })
export class NoteArchiveService {
  private static readonly manifestPath = 'manifest.json';
  private static readonly attachmentsDir = 'attachments';

  async exportNote(note: Note, attachments: Map<string, Blob>): Promise<Blob> {
    const zip = new JSZip();
    const manifest: NoteArchiveManifest = {
      format: 'mrn',
      version: 1,
      exportedAt: new Date().toISOString(),
      note: {
        title: note.title,
        createdAt: note.createdAt,
        lastModifiedAt: note.lastModifiedAt,
        elements: note.elements.map((element) => this.cloneElement(element)),
        attachments: note.attachments.map((attachment) => ({ ...attachment })),
      },
    };

    zip.file(NoteArchiveService.manifestPath, JSON.stringify(manifest, null, 2));
    const attachmentsFolder = zip.folder(NoteArchiveService.attachmentsDir);
    if (!attachmentsFolder) {
      throw new Error('Could not create archive attachments folder.');
    }

    for (const attachment of note.attachments) {
      const blob = attachments.get(attachment.id);
      if (!blob) {
        throw new Error(`Attachment "${attachment.name}" is missing from note storage.`);
      }

      attachmentsFolder.file(attachment.id, blob);
    }

    return zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      mimeType: 'application/x-raz-notes',
    });
  }

  async inspectArchive(file: Blob): Promise<{ title: string }> {
    const manifest = await this.readManifest(file);
    return { title: manifest.note.title };
  }

  async importNote(file: Blob): Promise<ImportedNoteArchive> {
    const zip = await JSZip.loadAsync(file);
    const manifest = await this.readManifestFromZip(zip);
    const attachmentFiles: { attachmentId: string; file: File }[] = [];

    for (const attachment of manifest.note.attachments) {
      const entry = zip.file(`${NoteArchiveService.attachmentsDir}/${attachment.id}`);
      if (!entry) {
        throw new Error(`Archive is missing attachment data for "${attachment.name}".`);
      }

      const blob = await entry.async('blob');
      attachmentFiles.push({
        attachmentId: attachment.id,
        file: new File([blob], attachment.name, { type: attachment.type }),
      });
    }

    this.validateAttachmentReferences(manifest.note.elements, manifest.note.attachments);

    return {
      note: {
        title: manifest.note.title,
        createdAt: manifest.note.createdAt,
        lastModifiedAt: manifest.note.lastModifiedAt,
        elements: manifest.note.elements.map((element) => this.cloneElement(element)),
        attachments: manifest.note.attachments.map((attachment) => ({ ...attachment })),
      },
      attachmentFiles,
    };
  }

  private async readManifest(file: Blob): Promise<NoteArchiveManifest> {
    const zip = await JSZip.loadAsync(file);
    return this.readManifestFromZip(zip);
  }

  private async readManifestFromZip(zip: JSZip): Promise<NoteArchiveManifest> {
    const manifestEntry = zip.file(NoteArchiveService.manifestPath);
    if (!manifestEntry) {
      throw new Error('Archive manifest is missing.');
    }

    const text = await manifestEntry.async('string');
    const parsed: unknown = JSON.parse(text);
    return this.normalizeManifest(parsed);
  }

  private normalizeManifest(value: unknown): NoteArchiveManifest {
    if (!value || typeof value !== 'object') {
      throw new Error('Archive manifest is invalid.');
    }

    const candidate = value as Partial<NoteArchiveManifest> & {
      note?: Partial<NoteArchiveManifest['note']> & Record<string, unknown>;
    };

    if (candidate.format !== 'mrn' || candidate.version !== 1 || !candidate.note) {
      throw new Error('Archive format is not supported.');
    }

    if (
      typeof candidate.note.title !== 'string' ||
      typeof candidate.note.createdAt !== 'string' ||
      typeof candidate.note.lastModifiedAt !== 'string' ||
      !Array.isArray(candidate.note.elements) ||
      !Array.isArray(candidate.note.attachments)
    ) {
      throw new Error('Archive note data is invalid.');
    }

    const attachments = candidate.note.attachments.map((attachment, index) =>
      this.normalizeAttachment(
        attachment as Partial<Attachment> & Record<string, unknown>,
        `attachment-${index}`,
      ),
    );
    const elements = candidate.note.elements.map((element, index) =>
      this.normalizeElement(element as unknown as Record<string, unknown>, index),
    );

    return {
      format: 'mrn',
      version: 1,
      exportedAt:
        typeof candidate.exportedAt === 'string'
          ? candidate.exportedAt
          : candidate.note.lastModifiedAt,
      note: {
        title: candidate.note.title.trim() || 'Untitled note',
        createdAt: candidate.note.createdAt,
        lastModifiedAt: candidate.note.lastModifiedAt,
        elements,
        attachments,
      },
    };
  }

  private normalizeAttachment(
    attachment: Partial<Attachment> & Record<string, unknown>,
    fallbackId: string,
  ): Attachment {
    return {
      id: typeof attachment.id === 'string' ? attachment.id : fallbackId,
      name: typeof attachment.name === 'string' ? attachment.name : 'Attachment',
      type: typeof attachment.type === 'string' ? attachment.type : 'application/octet-stream',
      size: typeof attachment.size === 'number' ? attachment.size : 0,
    };
  }

  private normalizeElement(element: Record<string, unknown>, index: number): NoteElement {
    if (element['type'] === 'checklist') {
      return normalizeChecklistElement({
        type: 'checklist',
        id: typeof element['id'] === 'string' ? (element['id'] as string) : `checklist-${index}`,
        x: typeof element['x'] === 'number' ? (element['x'] as number) : 0,
        y: typeof element['y'] === 'number' ? (element['y'] as number) : 0,
        width: typeof element['width'] === 'number' ? (element['width'] as number) : undefined,
        height: typeof element['height'] === 'number' ? (element['height'] as number) : undefined,
        items: Array.isArray(element['items']) ? (element['items'] as unknown[]) : [],
      });
    }

    if (element['type'] === 'attachment') {
      return normalizeAttachmentElement({
        type: 'attachment',
        id: typeof element['id'] === 'string' ? (element['id'] as string) : `attachment-${index}`,
        attachmentId:
          typeof element['attachmentId'] === 'string' ? (element['attachmentId'] as string) : '',
        x: typeof element['x'] === 'number' ? (element['x'] as number) : 0,
        y: typeof element['y'] === 'number' ? (element['y'] as number) : 0,
        width: typeof element['width'] === 'number' ? (element['width'] as number) : undefined,
        height: typeof element['height'] === 'number' ? (element['height'] as number) : undefined,
      });
    }

    return normalizeNoteTextElement({
      type: 'text',
      id: typeof element['id'] === 'string' ? (element['id'] as string) : `text-${index}`,
      text: typeof element['text'] === 'string' ? (element['text'] as string) : 'New text',
      richTextHtml:
        typeof element['richTextHtml'] === 'string'
          ? (element['richTextHtml'] as string)
          : undefined,
      x: typeof element['x'] === 'number' ? (element['x'] as number) : 0,
      y: typeof element['y'] === 'number' ? (element['y'] as number) : 0,
      width: typeof element['width'] === 'number' ? (element['width'] as number) : undefined,
      height: typeof element['height'] === 'number' ? (element['height'] as number) : undefined,
      fontSize:
        typeof element['fontSize'] === 'number' ? (element['fontSize'] as number) : undefined,
      color: typeof element['color'] === 'string' ? (element['color'] as string) : undefined,
      fontFamily:
        typeof element['fontFamily'] === 'string' ? (element['fontFamily'] as string) : undefined,
      bold: typeof element['bold'] === 'boolean' ? (element['bold'] as boolean) : undefined,
      italic: typeof element['italic'] === 'boolean' ? (element['italic'] as boolean) : undefined,
      underline:
        typeof element['underline'] === 'boolean' ? (element['underline'] as boolean) : undefined,
    });
  }

  private validateAttachmentReferences(elements: NoteElement[], attachments: Attachment[]): void {
    const attachmentIds = new Set(attachments.map((attachment) => attachment.id));
    for (const element of elements) {
      if (element.type === 'attachment' && !attachmentIds.has(element.attachmentId)) {
        throw new Error(`Archive is missing metadata for attachment "${element.attachmentId}".`);
      }
    }
  }

  private cloneElement(element: NoteElement): NoteElement {
    if (element.type === 'checklist') {
      return normalizeChecklistElement({
        ...element,
        items: structuredClone(element.items),
      });
    }

    if (element.type === 'attachment') {
      return normalizeAttachmentElement({ ...element });
    }

    return normalizeNoteTextElement({ ...element, type: 'text' });
  }
}
