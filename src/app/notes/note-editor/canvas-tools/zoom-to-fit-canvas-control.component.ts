import { Component, EventEmitter, Output } from '@angular/core';

import { CanvasToolButtonComponent } from './canvas-tool-button.component';

@Component({
  selector: 'app-zoom-to-fit-canvas-control',
  imports: [CanvasToolButtonComponent],
  template: `
    <app-canvas-tool-button
      ariaLabel="Zoom out to fit"
      title="Zoom out to fit"
      icon="fa-solid fa-magnifying-glass-minus"
      variant="floating"
      (pressed)="pressed.emit()"
    />
  `,
})
export class ZoomToFitCanvasControlComponent {
  @Output() readonly pressed = new EventEmitter<void>();
}
