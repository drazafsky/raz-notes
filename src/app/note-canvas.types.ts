import type { NoteElement } from './storage.service';

export type CanvasTool = 'selection' | 'text' | 'checklist';

export interface FontOption {
  label: string;
  value: string;
}

export interface SaveNotification {
  type: 'success' | 'error';
  message: string;
  dismissable: boolean;
}

export interface DragAlignmentGuide {
  orientation: 'vertical' | 'horizontal';
  position: number;
  snapped: boolean;
}

export interface CanvasHistorySnapshot {
  elements: NoteElement[];
}
