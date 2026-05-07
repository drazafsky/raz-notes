import { Component, EventEmitter, Input, Output } from '@angular/core';

import { CanvasToolButtonComponent } from './canvas-tool-button.component';

@Component({
  selector: 'app-match-size-canvas-tool',
  imports: [CanvasToolButtonComponent],
  template: `
    <app-canvas-tool-button
      ariaLabel="Match selected element sizes"
      title="Match selected element sizes"
      icon="fa-solid fa-expand"
      [disabled]="disabled"
      (pressed)="pressed.emit()"
    />
  `,
})
export class MatchSizeCanvasToolComponent {
  @Input() disabled = false;
  @Output() readonly pressed = new EventEmitter<void>();
}
