import { Component, EventEmitter, Output } from '@angular/core';

import { CanvasToolButtonComponent } from './canvas-tool-button.component';

@Component({
  selector: 'app-attachment-canvas-tool',
  imports: [CanvasToolButtonComponent],
  template: `
    <app-canvas-tool-button
      ariaLabel="Attach files"
      title="Attach files"
      icon="fa-solid fa-paperclip"
      (pressed)="pressed.emit()"
    />
  `,
})
export class AttachmentCanvasToolComponent {
  @Output() readonly pressed = new EventEmitter<void>();
}
