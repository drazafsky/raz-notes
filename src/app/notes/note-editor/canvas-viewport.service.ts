import { Injectable } from '@angular/core';

import { computeNoteContentBounds } from '../note-svg.utils';
import type { NoteElement } from '../storage.service';

export interface CanvasViewportState {
  viewX: number;
  viewY: number;
  scale: number;
}

const MIN_CANVAS_SCALE = 0.25;
const MAX_CANVAS_SCALE = 6;
const FIT_CONTENT_PADDING = 72;

@Injectable({ providedIn: 'root' })
export class CanvasViewportService {
  clampScale(scale: number): number {
    return Math.min(MAX_CANVAS_SCALE, Math.max(MIN_CANVAS_SCALE, scale));
  }

  defaultView(rect: Pick<DOMRect, 'width' | 'height'>, currentScale: number): CanvasViewportState {
    return {
      viewX: rect.width / 2,
      viewY: rect.height / 2,
      scale: this.clampScale(currentScale),
    };
  }

  centeredView(
    elements: NoteElement[],
    rect: Pick<DOMRect, 'width' | 'height'>,
    scale: number,
  ): CanvasViewportState {
    const bounds = computeNoteContentBounds(elements);
    if (!bounds) {
      return this.defaultView(rect, scale);
    }

    const nextScale = this.clampScale(scale);
    return {
      viewX: rect.width / 2 - bounds.centerX * nextScale,
      viewY: rect.height / 2 - bounds.centerY * nextScale,
      scale: nextScale,
    };
  }

  fitScale(
    elements: NoteElement[],
    rect: Pick<DOMRect, 'width' | 'height'>,
    fallback: number,
  ): number {
    const bounds = computeNoteContentBounds(elements);
    if (!bounds) {
      return fallback;
    }

    return this.clampScale(
      Math.min(
        rect.width / Math.max(bounds.width + FIT_CONTENT_PADDING * 2, 1),
        rect.height / Math.max(bounds.height + FIT_CONTENT_PADDING * 2, 1),
      ),
    );
  }

  zoomToFit(
    elements: NoteElement[],
    rect: Pick<DOMRect, 'width' | 'height'>,
    fallback: number,
  ): CanvasViewportState {
    return this.centeredView(elements, rect, this.fitScale(elements, rect, fallback));
  }

  pointerToCanvas(
    event:
      | Pick<PointerEvent, 'clientX' | 'clientY'>
      | Pick<WheelEvent, 'clientX' | 'clientY'>
      | Pick<DragEvent, 'clientX' | 'clientY'>,
    rect: Pick<DOMRect, 'left' | 'top'>,
    viewX: number,
    viewY: number,
    scale: number,
  ): { x: number; y: number } {
    return {
      x: (event.clientX - rect.left - viewX) / scale,
      y: (event.clientY - rect.top - viewY) / scale,
    };
  }

  wheelZoom(
    event: Pick<WheelEvent, 'clientX' | 'clientY' | 'deltaY'>,
    rect: Pick<DOMRect, 'left' | 'top'>,
    state: CanvasViewportState,
  ): CanvasViewportState {
    const point = this.pointerToCanvas(event, rect, state.viewX, state.viewY, state.scale);
    const nextScale = this.clampScale(state.scale * (event.deltaY < 0 ? 1.1 : 0.9));
    if (nextScale === state.scale) {
      return state;
    }

    return {
      viewX: event.clientX - rect.left - point.x * nextScale,
      viewY: event.clientY - rect.top - point.y * nextScale,
      scale: nextScale,
    };
  }
}
