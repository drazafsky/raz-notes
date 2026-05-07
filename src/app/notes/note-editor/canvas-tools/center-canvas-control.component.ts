import { Component, EventEmitter, Output } from '@angular/core';

import { CanvasToolButtonComponent } from './canvas-tool-button.component';

@Component({
  selector: 'app-center-canvas-control',
  imports: [CanvasToolButtonComponent],
  template: `
    <app-canvas-tool-button
      ariaLabel="Center canvas"
      title="Center canvas"
      icon="fa-solid fa-crosshairs"
      variant="floating"
      (pressed)="pressed.emit()"
    />
  `,
})
export class CenterCanvasControlComponent {
  @Output() readonly pressed = new EventEmitter<void>();
}
