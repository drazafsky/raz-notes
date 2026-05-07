import { Injectable } from '@angular/core';

import type { CanvasTool } from './note-canvas.types';

@Injectable()
export class CanvasToolbarStateService {
  private currentTool: CanvasTool = 'selection';

  activeTool(): CanvasTool {
    return this.currentTool;
  }

  setActiveTool(tool: CanvasTool): void {
    this.currentTool = tool;
  }

  reset(): void {
    this.currentTool = 'selection';
  }
}
