import { Component, EventEmitter, Input, Output } from '@angular/core';

import { CanvasToolButtonComponent } from './canvas-tool-button.component';

@Component({
  selector: 'app-undo-canvas-tool',
  imports: [CanvasToolButtonComponent],
  template: `
    <app-canvas-tool-button
      ariaLabel="Undo"
      title="Undo"
      icon="fa-solid fa-rotate-left"
      [disabled]="disabled"
      (pressed)="pressed.emit()"
    />
  `,
})
export class UndoCanvasToolComponent {
  @Input() disabled = false;
  @Output() readonly pressed = new EventEmitter<void>();
}
