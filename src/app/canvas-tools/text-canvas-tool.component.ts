import { Component, EventEmitter, Input, Output } from '@angular/core';

import { CanvasToolButtonComponent } from './canvas-tool-button.component';

@Component({
  selector: 'app-text-canvas-tool',
  imports: [CanvasToolButtonComponent],
  template: `
    <app-canvas-tool-button
      ariaLabel="Text tool"
      title="Text tool"
      icon="fa-solid fa-font"
      [active]="active"
      (pressed)="pressed.emit()"
    />
  `,
})
export class TextCanvasToolComponent {
  @Input() active = false;
  @Output() readonly pressed = new EventEmitter<void>();
}
