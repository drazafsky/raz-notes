import { Component, Input } from '@angular/core';

import { AttachmentViewerComponent } from '../../attachment-viewer/attachment-viewer.component';
import type { AttachmentCanvasElementController } from '../canvas-element-controllers';
import type { NoteAttachmentElement } from '../../storage.service';

@Component({
  selector: 'g[appAttachmentCanvasElement]', // eslint-disable-line @angular-eslint/component-selector
  imports: [AttachmentViewerComponent],
  templateUrl: './attachment-canvas-element.component.html',
})
export class AttachmentCanvasElementComponent {
  @Input({ required: true }) controller!: AttachmentCanvasElementController;
  @Input({ required: true }) element!: NoteAttachmentElement;
}
