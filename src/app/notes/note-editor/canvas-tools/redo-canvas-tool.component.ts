import { Component, EventEmitter, Input, Output } from '@angular/core';

import { CanvasToolButtonComponent } from './canvas-tool-button.component';

@Component({
  selector: 'app-redo-canvas-tool',
  imports: [CanvasToolButtonComponent],
  template: `
    <app-canvas-tool-button
      ariaLabel="Redo"
      title="Redo"
      icon="fa-solid fa-rotate-right"
      [disabled]="disabled"
      (pressed)="pressed.emit()"
    />
  `,
})
export class RedoCanvasToolComponent {
  @Input() disabled = false;
  @Output() readonly pressed = new EventEmitter<void>();
}
