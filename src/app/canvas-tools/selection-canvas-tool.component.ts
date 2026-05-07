import { Component, EventEmitter, Input, Output } from '@angular/core';

import { CanvasToolButtonComponent } from './canvas-tool-button.component';

@Component({
  selector: 'app-selection-canvas-tool',
  imports: [CanvasToolButtonComponent],
  template: `
    <app-canvas-tool-button
      ariaLabel="Selection tool"
      title="Selection tool"
      icon="fa-solid fa-arrow-pointer"
      [active]="active"
      (pressed)="pressed.emit()"
    />
  `,
})
export class SelectionCanvasToolComponent {
  @Input() active = false;
  @Output() readonly pressed = new EventEmitter<void>();
}
