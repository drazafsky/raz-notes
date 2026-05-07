import { Component, EventEmitter, Input, Output } from '@angular/core';

import { CanvasToolButtonComponent } from './canvas-tool-button.component';

@Component({
  selector: 'app-alignment-guides-canvas-control',
  imports: [CanvasToolButtonComponent],
  template: `
    <app-canvas-tool-button
      ariaLabel="Toggle alignment guides"
      title="Toggle alignment guides"
      icon="fa-solid fa-magnet"
      variant="floating"
      [active]="active"
      (pressed)="pressed.emit()"
    />
  `,
})
export class AlignmentGuidesCanvasControlComponent {
  @Input() active = false;
  @Output() readonly pressed = new EventEmitter<void>();
}
