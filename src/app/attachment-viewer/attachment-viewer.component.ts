import { Component, Input, OnInit, OnDestroy, inject } from '@angular/core';
import { DomSanitizer, SafeResourceUrl, SafeUrl } from '@angular/platform-browser';
import { Attachment, StorageService } from '../storage.service';

type AttachmentCategory = 'image' | 'video' | 'audio' | 'pdf' | 'other';

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

  loading = true;
  error = false;
  category: AttachmentCategory = 'other';
  safeUrl: SafeUrl = '';
  safeResourceUrl: SafeResourceUrl = '';

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

      const mt = this.attachment.type;
      if (mt.startsWith('image/')) {
        this.category = 'image';
      } else if (mt.startsWith('video/')) {
        this.category = 'video';
      } else if (mt.startsWith('audio/')) {
        this.category = 'audio';
      } else if (mt === 'application/pdf') {
        this.category = 'pdf';
      }
    } catch {
      this.error = true;
    }
    this.loading = false;
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
