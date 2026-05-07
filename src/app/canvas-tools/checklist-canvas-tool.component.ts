import { Component, EventEmitter, Input, Output } from '@angular/core';

import { CanvasToolButtonComponent } from './canvas-tool-button.component';

@Component({
  selector: 'app-checklist-canvas-tool',
  imports: [CanvasToolButtonComponent],
  template: `
    <app-canvas-tool-button
      ariaLabel="Checklist tool"
      title="Checklist tool"
      icon="fa-solid fa-list-check"
      [active]="active"
      (pressed)="pressed.emit()"
    />
  `,
})
export class ChecklistCanvasToolComponent {
  @Input() active = false;
  @Output() readonly pressed = new EventEmitter<void>();
}
