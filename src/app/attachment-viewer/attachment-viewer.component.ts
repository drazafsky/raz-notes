import { Component, Input, OnDestroy, OnInit, inject } from '@angular/core';
import { DomSanitizer, SafeHtml, SafeResourceUrl, SafeUrl } from '@angular/platform-browser';

import {
  AttachmentPreviewCategory,
  AttachmentPreviewService,
  WorkbookAttachmentPreview,
} from './attachment-preview.service';
import { Attachment, StorageService } from '../storage.service';

@Component({
  selector: 'app-attachment-viewer',
  standalone: true,
  templateUrl: './attachment-viewer.component.html',
})
export class AttachmentViewerComponent implements OnInit, OnDestroy {
  @Input() noteId: number | null = null;
  @Input({ required: true }) attachment!: Attachment;
  @Input() attachmentBlob: Blob | null = null;
  @Input() compact = false;

  private storage = inject(StorageService);
  private sanitizer = inject(DomSanitizer);
  private previewService = inject(AttachmentPreviewService);

  loading = true;
  error = false;
  category: AttachmentPreviewCategory = 'other';
  previewMode: 'fallback' | 'html' | 'native' | 'workbook' = 'fallback';
  fallbackMessage = '';
  renderedHtml: SafeHtml = '';
  renderedSummary = '';
  safeUrl: SafeUrl = '';
  safeResourceUrl: SafeResourceUrl = '';
  workbookPreview: WorkbookAttachmentPreview | null = null;
  workbookSheetHtml: SafeHtml[] = [];
  activeSheetIndex = 0;

  private objectUrl = '';

  async ngOnInit(): Promise<void> {
    try {
      const blob =
        this.attachmentBlob ??
        (this.noteId === null
          ? null
          : await this.storage.readAttachment(
              this.noteId,
              this.attachment.id,
              this.attachment.type,
            ));
      if (!blob) {
        throw new Error('Attachment preview is unavailable.');
      }
      this.objectUrl = URL.createObjectURL(blob);
      this.safeUrl = this.sanitizer.bypassSecurityTrustUrl(this.objectUrl);
      this.safeResourceUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl);

      const preview = await this.previewService.createPreview(this.attachment, blob, {
        compact: this.compact,
      });
      this.category = preview.category;
      switch (preview.mode) {
        case 'native':
          this.previewMode = 'native';
          break;
        case 'html':
          this.previewMode = 'html';
          this.renderedSummary = preview.summary;
          this.renderedHtml = this.sanitizer.bypassSecurityTrustHtml(preview.html);
          break;
        case 'workbook':
          this.previewMode = 'workbook';
          this.workbookPreview = preview;
          this.activeSheetIndex = preview.activeSheetIndex;
          this.renderedSummary = preview.summary;
          this.workbookSheetHtml = preview.sheets.map((sheet) =>
            this.sanitizer.bypassSecurityTrustHtml(sheet.html),
          );
          break;
        case 'fallback':
          this.previewMode = 'fallback';
          this.fallbackMessage = preview.message;
          break;
      }
    } catch {
      this.error = true;
    }
    this.loading = false;
  }

  activeWorkbookSheetHtml(): SafeHtml {
    return this.workbookSheetHtml[this.activeSheetIndex] ?? '';
  }

  activeWorkbookSheetSummary(): string {
    return this.workbookPreview?.sheets[this.activeSheetIndex]?.summary ?? '';
  }

  selectWorkbookSheet(index: number): void {
    if (!this.workbookPreview || index < 0 || index >= this.workbookPreview.sheets.length) {
      return;
    }

    this.activeSheetIndex = index;
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  ngOnDestroy(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
    }
  }
}
