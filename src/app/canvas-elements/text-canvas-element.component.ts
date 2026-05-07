import { Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';

import type { TextCanvasElementController } from '../canvas-element-controllers';
import type { NoteTextElement } from '../storage.service';

@Component({
  selector: 'g[appTextCanvasElement]', // eslint-disable-line @angular-eslint/component-selector
  imports: [FormsModule],
  templateUrl: './text-canvas-element.component.html',
})
export class TextCanvasElementComponent {
  @Input({ required: true }) controller!: TextCanvasElementController;
  @Input({ required: true }) element!: NoteTextElement;
}
