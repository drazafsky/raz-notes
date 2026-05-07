import { Injectable } from '@angular/core';

import { DEFAULT_TEXT_ELEMENT_WIDTH, normalizeNoteTextElement } from './note-svg.utils';
import type { NoteTextElement } from './storage.service';

@Injectable({ providedIn: 'root' })
export class TextCanvasToolService {
  createElement(x: number, y: number): NoteTextElement {
    return normalizeNoteTextElement({
      id: crypto.randomUUID(),
      type: 'text',
      text: 'New text',
      x,
      y,
      width: DEFAULT_TEXT_ELEMENT_WIDTH,
    });
  }

  applyPatch(element: NoteTextElement, patch: Partial<NoteTextElement>): NoteTextElement {
    return normalizeNoteTextElement({ ...element, ...patch });
  }
}
