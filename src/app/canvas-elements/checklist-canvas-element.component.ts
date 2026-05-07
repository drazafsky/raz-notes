import { Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';

import type { ChecklistCanvasElementController } from '../canvas-element-controllers';
import type { NoteChecklistElement } from '../storage.service';

@Component({
  selector: 'g[appChecklistCanvasElement]', // eslint-disable-line @angular-eslint/component-selector
  imports: [FormsModule],
  templateUrl: './checklist-canvas-element.component.html',
})
export class ChecklistCanvasElementComponent {
  @Input({ required: true }) controller!: ChecklistCanvasElementController;
  @Input({ required: true }) element!: NoteChecklistElement;
}
