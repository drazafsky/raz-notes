import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';

import { NoteDetailsPageComponent } from './note-details-page.component';
import { NotesStateService } from './notes-state.service';
import { Note, StorageService } from './storage.service';

class MockNotesStateService {
  note: Note = {
    id: 7,
    title: 'Existing note',
    elements: [{ id: 't1', text: 'Saved body', x: 0, y: 0, width: 180, fontSize: 24 }],
    createdAt: '2026-04-19T00:00:00.000Z',
    lastModifiedAt: '2026-04-19T00:00:00.000Z',
    attachments: [{ id: 'a1', name: 'file.txt', type: 'text/plain', size: 4 }],
  };

  getNote(noteId: number): Note | undefined {
    return noteId === this.note.id ? this.note : undefined;
  }

  updateNote = jasmine
    .createSpy('updateNote')
    .and.callFake(async (_noteId: number, input: { title: string }) => ({
      ...this.note,
      title: input.title,
      lastModifiedAt: '2026-04-19T02:00:00.000Z',
    }));

  createNote = jasmine.createSpy('createNote');
  deleteNote = jasmine.createSpy('deleteNote').and.returnValue(Promise.resolve());
  deleteAttachment = jasmine
    .createSpy('deleteAttachment')
    .and.callFake(async (_noteId: number, attachmentId: string) => ({
      ...this.note,
      attachments: this.note.attachments.filter((attachment) => attachment.id !== attachmentId),
      lastModifiedAt: '2026-04-19T03:00:00.000Z',
    }));
}

describe('NoteDetailsPageComponent', () => {
  async function createComponent(notesState = new MockNotesStateService()) {
    await TestBed.configureTestingModule({
      imports: [NoteDetailsPageComponent],
      providers: [
        provideRouter([]),
        { provide: NotesStateService, useValue: notesState },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: {
                get: (key: string) => (key === 'id' ? '7' : null),
              },
            },
          },
        },
        {
          provide: StorageService,
          useValue: jasmine.createSpyObj<StorageService>('StorageService', {
            readAttachment: Promise.resolve(new Blob(['demo'], { type: 'text/plain' })),
          }),
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(NoteDetailsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  it('prepopulates the selected note', async () => {
    const notesState = new MockNotesStateService();
    const fixture = await createComponent(notesState);

    expect(fixture.componentInstance.activeTool).toBe('selection');
    expect(fixture.componentInstance.noteTitle).toBe('Existing note');
    expect(fixture.componentInstance.elements[0].text).toBe('Saved body');
  });

  it('deletes a note and navigates back to the list', async () => {
    const notesState = new MockNotesStateService();
    const fixture = await createComponent(notesState);
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));

    await fixture.componentInstance.deleteNote();

    expect(notesState.deleteNote).toHaveBeenCalledWith(7);
    expect(router.navigate).toHaveBeenCalledWith(['/notes']);
  });

  it('deletes an attachment from the detail page', async () => {
    const notesState = new MockNotesStateService();
    const fixture = await createComponent(notesState);

    await fixture.componentInstance.deleteAttachment('a1');

    expect(notesState.deleteAttachment).toHaveBeenCalledWith(7, 'a1');
    expect(fixture.componentInstance.note?.attachments).toEqual([]);
  });

  it('clicks a text element into edit mode when the selection tool is active', async () => {
    const notesState = new MockNotesStateService();
    notesState.note = {
      ...notesState.note,
      elements: [
        { id: 't1', text: 'Saved body', x: 0, y: 0, width: 180, fontSize: 24 },
        { id: 't2', text: 'Second', x: 60, y: 60, width: 180, fontSize: 24 },
      ],
    };
    const fixture = await createComponent(notesState);

    fixture.componentInstance.onTextPointerDown(
      {
        button: 0,
        clientX: 10,
        clientY: 10,
        stopPropagation: () => undefined,
      } as PointerEvent,
      't2',
    );
    fixture.componentInstance.onDocumentPointerUp({} as PointerEvent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.selectedElementId).toBe('t2');
    expect(fixture.componentInstance.editingElementId).toBe('t2');
    expect(fixture.nativeElement.querySelector('#text-editor-t2')).toBeTruthy();
  });

  it('clicking rendered text enters edit mode through DOM events', async () => {
    const fixture = await createComponent();
    const textElement = fixture.nativeElement.querySelector('foreignObject div');

    textElement.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 10,
        clientY: 10,
      }),
    );
    document.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        button: 0,
        clientX: 10,
        clientY: 10,
      }),
    );
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.editingElementId).toBe('t1');
    expect(fixture.nativeElement.querySelector('#text-editor-t1')).toBeTruthy();
  });

  it('creates a text element only when the text tool is active', async () => {
    const fixture = await createComponent();
    const initialCount = fixture.componentInstance.elements.length;
    const selectSpy = spyOn(HTMLTextAreaElement.prototype, 'select').and.callThrough();

    fixture.componentInstance.setActiveTool('text');
    fixture.componentInstance.onCanvasPointerDown({
      button: 0,
      clientX: 100,
      clientY: 120,
    } as PointerEvent);
    fixture.componentInstance.onDocumentPointerUp({
      clientX: 100,
      clientY: 120,
    } as PointerEvent);
    fixture.detectChanges();
    await fixture.whenStable();

    const editor = fixture.nativeElement.querySelector(
      `#${fixture.componentInstance.inlineEditorId(fixture.componentInstance.elements.at(-1)!.id)}`,
    ) as HTMLTextAreaElement;

    expect(fixture.componentInstance.elements.length).toBe(initialCount + 1);
    expect(fixture.componentInstance.editingElementId).toBe(
      fixture.componentInstance.elements.at(-1)!.id,
    );
    expect(selectSpy).toHaveBeenCalled();
    expect(document.activeElement).toBe(editor);
  });

  it('does not create a text element when the selection tool is active', async () => {
    const fixture = await createComponent();
    const initialCount = fixture.componentInstance.elements.length;

    fixture.componentInstance.onCanvasPointerDown({
      button: 0,
      clientX: 100,
      clientY: 120,
    } as PointerEvent);
    fixture.componentInstance.onDocumentPointerUp({
      clientX: 100,
      clientY: 120,
    } as PointerEvent);

    expect(fixture.componentInstance.elements.length).toBe(initialCount);
  });

  it('enters inline edit mode on double click', async () => {
    const fixture = await createComponent();

    fixture.componentInstance.onTextDoubleClick(
      { stopPropagation: () => undefined } as MouseEvent,
      't1',
    );
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.editingElementId).toBe('t1');
    expect(fixture.nativeElement.querySelector('#text-editor-t1')).toBeTruthy();
  });

  it('updates text with inline multiline editing', async () => {
    const fixture = await createComponent();

    fixture.componentInstance.onTextDoubleClick(
      { stopPropagation: () => undefined } as MouseEvent,
      't1',
    );
    fixture.componentInstance.updateEditingText('t1', 'Line 1\nLine 2');

    expect(fixture.componentInstance.elements[0].text).toBe('Line 1\nLine 2');
  });

  it('resizes the selected element without changing its font size', async () => {
    const fixture = await createComponent();

    fixture.componentInstance.onResizeHandlePointerDown(
      {
        button: 0,
        clientX: 10,
        clientY: 10,
        stopPropagation: () => undefined,
      } as PointerEvent,
      't1',
    );
    fixture.componentInstance.onDocumentPointerMove({
      clientX: 50,
      clientY: 42,
    } as PointerEvent);

    expect(fixture.componentInstance.elements[0].width).toBeGreaterThan(180);
    expect(fixture.componentInstance.elements[0].height).toBeGreaterThan(
      fixture.componentInstance.textFontSize * 1.6,
    );
    expect(fixture.componentInstance.elements[0].fontSize).toBe(
      fixture.componentInstance.textFontSize,
    );
  });

  it('deletes the selected text element with the delete key', async () => {
    const notesState = new MockNotesStateService();
    notesState.note = {
      ...notesState.note,
      elements: [
        { id: 't1', text: 'Saved body', x: 0, y: 0, width: 180, fontSize: 24 },
        { id: 't2', text: 'Second', x: 60, y: 60, width: 180, fontSize: 24 },
      ],
    };
    const fixture = await createComponent(notesState);
    const preventDefault = jasmine.createSpy('preventDefault');

    fixture.componentInstance.selectedElementId = 't2';
    fixture.componentInstance.onDocumentKeyDown({
      key: 'Delete',
      preventDefault,
    } as unknown as KeyboardEvent);

    expect(preventDefault).toHaveBeenCalled();
    expect(fixture.componentInstance.elements.map((element) => element.id)).toEqual(['t1']);
    expect(fixture.componentInstance.selectedElementId).toBe('t1');
  });

  it('removes external text configuration inputs from the editor layout', async () => {
    const fixture = await createComponent();
    fixture.componentInstance.selectedElementId = 't1';
    fixture.detectChanges();
    const selectionRect = fixture.nativeElement.querySelector('svg g g rect');
    const textNode = fixture.nativeElement.querySelector('foreignObject div');

    expect(fixture.nativeElement.querySelector('button[aria-label="Selection tool"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('button[aria-label="Text tool"]')).toBeTruthy();
    expect(selectionRect.getAttribute('stroke-dasharray')).toBe('8 6');
    expect(textNode.style.cursor).toBe('move');
    expect(fixture.nativeElement.textContent).not.toContain('Selected text');
    expect(fixture.nativeElement.textContent).not.toContain('Width');
    expect(fixture.nativeElement.textContent).not.toContain('Font size');
  });
});
