import { Injectable } from '@angular/core';

import type { CanvasHistorySnapshot } from './note-canvas.types';

@Injectable()
export class CanvasHistoryService {
  private undoStack: CanvasHistorySnapshot[] = [];
  private redoStack: CanvasHistorySnapshot[] = [];
  private replaying = false;

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  isReplayingHistory(): boolean {
    return this.replaying;
  }

  record(snapshot: CanvasHistorySnapshot): void {
    if (this.replaying) {
      return;
    }

    this.undoStack.push(snapshot);
    this.redoStack = [];
  }

  undo(currentSnapshot: CanvasHistorySnapshot): CanvasHistorySnapshot | null {
    const snapshot = this.undoStack.pop();
    if (!snapshot) {
      return null;
    }

    this.redoStack.push(currentSnapshot);
    return snapshot;
  }

  redo(currentSnapshot: CanvasHistorySnapshot): CanvasHistorySnapshot | null {
    const snapshot = this.redoStack.pop();
    if (!snapshot) {
      return null;
    }

    this.undoStack.push(currentSnapshot);
    return snapshot;
  }

  withReplay<T>(callback: () => T): T {
    this.replaying = true;
    try {
      return callback();
    } finally {
      this.replaying = false;
    }
  }

  reset(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.replaying = false;
  }
}
