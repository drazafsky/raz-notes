import { Injectable } from '@angular/core';

import {
  DEFAULT_ATTACHMENT_ELEMENT_HEIGHT,
  DEFAULT_ATTACHMENT_ELEMENT_WIDTH,
  isAttachmentElement,
  normalizeAttachmentElement,
} from '../note-svg.utils';
import type { PendingAttachment } from '../notes-state.service';
import type { Attachment, Note, NoteAttachmentElement, NoteElement } from '../storage.service';

export interface PendingAttachmentInsertion {
  pendingAttachments: PendingAttachment[];
  elements: NoteAttachmentElement[];
}

@Injectable({ providedIn: 'root' })
export class AttachmentCanvasToolService {
  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  buildPendingAttachmentInsertions(
    files: File[],
    origin: { x: number; y: number },
  ): PendingAttachmentInsertion {
    const pendingAttachments: PendingAttachment[] = [];
    const elements: NoteAttachmentElement[] = [];

    files.forEach((file, index) => {
      const attachment: Attachment = {
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type,
        size: file.size,
      };
      pendingAttachments.push({ attachment, file });
      elements.push(
        normalizeAttachmentElement({
          id: crypto.randomUUID(),
          type: 'attachment',
          attachmentId: attachment.id,
          x: origin.x + index * 24,
          y: origin.y + index * 24,
          width: DEFAULT_ATTACHMENT_ELEMENT_WIDTH,
          height: DEFAULT_ATTACHMENT_ELEMENT_HEIGHT,
        }),
      );
    });

    return { pendingAttachments, elements };
  }

  attachmentForElement(
    note: Note | null,
    pendingAttachments: PendingAttachment[],
    element: NoteAttachmentElement,
  ): Attachment | null {
    return (
      pendingAttachments.find((candidate) => candidate.attachment.id === element.attachmentId)
        ?.attachment ??
      note?.attachments.find((attachment) => attachment.id === element.attachmentId) ??
      null
    );
  }

  attachmentBlobForElement(
    pendingAttachments: PendingAttachment[],
    element: NoteAttachmentElement,
  ): Blob | null {
    return (
      pendingAttachments.find((candidate) => candidate.attachment.id === element.attachmentId)
        ?.file ?? null
    );
  }

  unplacedAttachments(note: Note | null, elements: NoteElement[]): Attachment[] {
    if (!note) {
      return [];
    }

    const placedAttachmentIds = new Set(
      elements
        .filter((element): element is NoteAttachmentElement => isAttachmentElement(element))
        .map((element) => element.attachmentId),
    );
    return note.attachments.filter((attachment) => !placedAttachmentIds.has(attachment.id));
  }
}
