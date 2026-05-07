import { Injectable } from '@angular/core';

import { createChecklistItem, normalizeChecklistElement } from './note-svg.utils';
import type {
  ChecklistItemState,
  NoteChecklistElement,
  NoteChecklistItem,
} from './storage.service';

@Injectable({ providedIn: 'root' })
export class ChecklistCanvasToolService {
  createElement(x: number, y: number): NoteChecklistElement {
    return normalizeChecklistElement({
      id: crypto.randomUUID(),
      type: 'checklist',
      x,
      y,
      items: [createChecklistItem('Checklist item')],
    });
  }

  createItem(text = ''): NoteChecklistItem {
    return createChecklistItem(text);
  }

  cycleState(state: ChecklistItemState): ChecklistItemState {
    return state === 'unchecked' ? 'partial' : state === 'partial' ? 'checked' : 'unchecked';
  }
}
