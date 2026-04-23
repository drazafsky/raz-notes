import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';

import { NoteDetailsPageComponent } from './note-details-page.component';
import { computeNoteContentBounds } from './note-svg.utils';
import { NotesStateService } from './notes-state.service';
import { Note, NoteTextElement, StorageService } from './storage.service';

class MockNotesStateService {
  updateError: Error | null = null;
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
    .and.callFake(async (_noteId: number, input: { title: string }) => {
      if (this.updateError) {
        throw this.updateError;
      }

      return {
        ...this.note,
        title: input.title,
        lastModifiedAt: '2026-04-19T02:00:00.000Z',
      };
    });

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
    spyOn(SVGElement.prototype, 'getBoundingClientRect').and.returnValue(
      new DOMRect(0, 0, 800, 600),
    );
    const fixture = await createComponent(notesState);
    const bounds = computeNoteContentBounds(notesState.note.elements)!;
    const expectedScale = Math.min(
      6,
      Math.max(0.25, Math.min(800 / (bounds.width + 144), 600 / (bounds.height + 144))),
    );

    expect(fixture.componentInstance.activeTool).toBe('selection');
    expect(fixture.componentInstance.noteTitle).toBe('Existing note');
    expect((fixture.componentInstance.elements[0] as NoteTextElement).text).toBe('Saved body');
    expect(fixture.componentInstance.scale).toBeCloseTo(expectedScale);
    expect(fixture.componentInstance.viewX).toBeCloseTo(400 - bounds.centerX * expectedScale);
    expect(fixture.componentInstance.viewY).toBeCloseTo(300 - bounds.centerY * expectedScale);
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

  it('shows a temporary notification after a successful save', async () => {
    jasmine.clock().install();
    try {
      const fixture = await createComponent();

      await fixture.componentInstance.saveNote();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('Note saved.');
      expect(
        fixture.nativeElement.querySelector('button[aria-label="Dismiss save notification"]'),
      ).toBeNull();

      jasmine.clock().tick(3000);
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).not.toContain('Note saved.');
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('shows a dismissable persistent notification when saving fails', async () => {
    const notesState = new MockNotesStateService();
    notesState.updateError = new Error('Failed to save note.');
    const fixture = await createComponent(notesState);

    await fixture.componentInstance.saveNote();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Failed to save note.');

    const dismissButton = fixture.nativeElement.querySelector(
      'button[aria-label="Dismiss save notification"]',
    ) as HTMLButtonElement;
    expect(dismissButton).toBeTruthy();

    dismissButton.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Failed to save note.');
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
    const textElement = fixture.nativeElement.querySelector('foreignObject div.select-none');

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
    ) as HTMLDivElement;

    expect(fixture.componentInstance.elements.length).toBe(initialCount + 1);
    expect(fixture.componentInstance.activeTool).toBe('selection');
    expect(fixture.componentInstance.editingElementId).toBe(
      fixture.componentInstance.elements.at(-1)!.id,
    );
    expect(document.activeElement).toBe(editor);
    expect(window.getSelection()?.toString()).toContain('New text');
  });

  it('keeps the default empty canvas view when centering without any elements', async () => {
    spyOn(SVGElement.prototype, 'getBoundingClientRect').and.returnValue(
      new DOMRect(0, 0, 900, 700),
    );
    const notesState = new MockNotesStateService();
    notesState.note = {
      ...notesState.note,
      elements: [],
    };
    const fixture = await createComponent(notesState);

    fixture.componentInstance.viewX = 12;
    fixture.componentInstance.viewY = 18;
    fixture.componentInstance.centerCanvas();

    expect(fixture.componentInstance.viewX).toBe(450);
    expect(fixture.componentInstance.viewY).toBe(350);
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

    expect((fixture.componentInstance.elements[0] as NoteTextElement).text).toBe('Line 1\nLine 2');
  });

  it('preserves rich text formatting when the element is not being edited', async () => {
    const notesState = new MockNotesStateService();
    notesState.note = {
      ...notesState.note,
      elements: [
        {
          id: 't1',
          text: 'Styled body',
          richTextHtml:
            '<span style="color: rgb(255, 0, 0); font-size: 32px; text-decoration: underline;">Styled</span> body',
          x: 0,
          y: 0,
          width: 180,
          fontSize: 24,
        },
      ],
    };
    const fixture = await createComponent(notesState);
    fixture.componentInstance.selectedElementId = 't1';
    fixture.componentInstance.editingElementId = null;
    fixture.detectChanges();

    const textNode = fixture.nativeElement.querySelector('foreignObject div.select-none');

    expect(textNode.innerHTML).toContain('font-size: 32px');
    expect(textNode.innerHTML).toContain('text-decoration: underline');
    expect(textNode.innerHTML).toContain('color: rgb(255, 0, 0)');
  });

  it('shows a toolbar for the selected text element and updates its styling', async () => {
    const fixture = await createComponent();
    fixture.componentInstance.selectedElementId = 't1';
    fixture.detectChanges();

    const fontFamilyControl = fixture.nativeElement.querySelector(
      '#font-family-t1',
    ) as HTMLSelectElement;
    const fontSizeControl = fixture.nativeElement.querySelector(
      '#font-size-t1',
    ) as HTMLSelectElement;
    const textColorControl = fixture.nativeElement.querySelector(
      '#text-color-t1',
    ) as HTMLInputElement;
    const boldButton = fixture.nativeElement.querySelector('button[aria-label="Bold"]');
    const italicButton = fixture.nativeElement.querySelector('button[aria-label="Italic"]');
    const underlineButton = fixture.nativeElement.querySelector('button[aria-label="Underline"]');
    const strikethroughButton = fixture.nativeElement.querySelector(
      'button[aria-label="Strikethrough"]',
    );
    const subscriptButton = fixture.nativeElement.querySelector('button[aria-label="Subscript"]');
    const superscriptButton = fixture.nativeElement.querySelector(
      'button[aria-label="Superscript"]',
    );
    const quickColorButtons = fixture.nativeElement.querySelectorAll(
      'button[aria-label^="Quick select color "]',
    );

    fixture.componentInstance.updateTextStyle('t1', {
      fontFamily: fixture.componentInstance.fontFamilyOptions[1].value,
      color: '#ff0000',
    });
    fixture.componentInstance.changeTextFontSize('t1', 32);
    fixture.componentInstance.toggleTextFormat('t1', 'bold');
    fixture.componentInstance.toggleTextFormat('t1', 'italic');
    fixture.componentInstance.toggleTextFormat('t1', 'underline');
    fixture.detectChanges();

    const textNode = fixture.nativeElement.querySelector('foreignObject div.select-none');

    expect(fontFamilyControl).toBeTruthy();
    expect(fontSizeControl).toBeTruthy();
    expect(textColorControl).toBeTruthy();
    expect(boldButton).toBeTruthy();
    expect(italicButton).toBeTruthy();
    expect(underlineButton).toBeTruthy();
    expect(strikethroughButton).toBeTruthy();
    expect(subscriptButton).toBeTruthy();
    expect(superscriptButton).toBeTruthy();
    expect(fontFamilyControl.options.length).toBeGreaterThan(3);
    expect(fontSizeControl.options.length).toBeGreaterThan(10);
    expect(quickColorButtons.length).toBeGreaterThan(3);
    expect((fixture.componentInstance.elements[0] as NoteTextElement).fontSize).toBe(32);
    expect((fixture.componentInstance.elements[0] as NoteTextElement).color).toBe('#ff0000');
    expect((fixture.componentInstance.elements[0] as NoteTextElement).fontFamily).toBe(
      fixture.componentInstance.fontFamilyOptions[1].value,
    );
    expect((fixture.componentInstance.elements[0] as NoteTextElement).bold).toBeTrue();
    expect((fixture.componentInstance.elements[0] as NoteTextElement).italic).toBeTrue();
    expect((fixture.componentInstance.elements[0] as NoteTextElement).underline).toBeTrue();
    expect(textNode.style.fontSize).toBe('32px');
    expect(textNode.style.fontWeight).toBe('700');
    expect(textNode.style.fontStyle).toBe('italic');
    expect(textNode.style.textDecoration).toContain('underline');
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

    expect((fixture.componentInstance.elements[0] as NoteTextElement).width).toBeGreaterThan(180);
    expect((fixture.componentInstance.elements[0] as NoteTextElement).height).toBeGreaterThan(
      fixture.componentInstance.textFontSize * 1.6,
    );
    expect((fixture.componentInstance.elements[0] as NoteTextElement).fontSize).toBe(
      fixture.componentInstance.textFontSize,
    );
  });

  it('recenters the canvas without changing the current zoom level', async () => {
    spyOn(SVGElement.prototype, 'getBoundingClientRect').and.returnValue(
      new DOMRect(0, 0, 1000, 800),
    );
    const notesState = new MockNotesStateService();
    notesState.note = {
      ...notesState.note,
      elements: [{ id: 't1', text: 'Saved body', x: 100, y: 200, width: 180, fontSize: 24 }],
    };
    const fixture = await createComponent(notesState);
    const bounds = computeNoteContentBounds(notesState.note.elements)!;
    fixture.componentInstance.scale = 2;
    fixture.componentInstance.viewX = -50;
    fixture.componentInstance.viewY = -80;
    fixture.detectChanges();

    (
      fixture.nativeElement.querySelector('button[aria-label="Center canvas"]') as HTMLButtonElement
    ).click();

    expect(fixture.componentInstance.scale).toBe(2);
    expect(fixture.componentInstance.viewX).toBeCloseTo(500 - bounds.centerX * 2);
    expect(fixture.componentInstance.viewY).toBeCloseTo(400 - bounds.centerY * 2);
  });

  it('zooms out and centers so all elements fit in view', async () => {
    spyOn(SVGElement.prototype, 'getBoundingClientRect').and.returnValue(
      new DOMRect(0, 0, 720, 480),
    );
    const notesState = new MockNotesStateService();
    notesState.note = {
      ...notesState.note,
      elements: [
        { id: 't1', text: 'Saved body', x: -160, y: -80, width: 200, fontSize: 24 },
        { id: 't2', text: 'Second body', x: 380, y: 260, width: 240, fontSize: 24 },
      ],
    };
    const fixture = await createComponent(notesState);
    const bounds = computeNoteContentBounds(notesState.note.elements)!;
    const expectedScale = Math.min(
      2.5,
      Math.max(0.25, Math.min(720 / (bounds.width + 144), 480 / (bounds.height + 144))),
    );
    fixture.componentInstance.scale = 2.5;
    fixture.componentInstance.viewX = 40;
    fixture.componentInstance.viewY = 60;
    fixture.detectChanges();

    (
      fixture.nativeElement.querySelector(
        'button[aria-label="Zoom out to fit"]',
      ) as HTMLButtonElement
    ).click();

    expect(fixture.componentInstance.scale).toBeCloseTo(expectedScale);
    expect(fixture.componentInstance.viewX).toBeCloseTo(360 - bounds.centerX * expectedScale);
    expect(fixture.componentInstance.viewY).toBeCloseTo(240 - bounds.centerY * expectedScale);
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

  it('creates and immediately edits a checklist element from the canvas toolbar', async () => {
    const fixture = await createComponent();
    const initialCount = fixture.componentInstance.elements.length;

    fixture.componentInstance.setActiveTool('checklist');
    fixture.componentInstance.onCanvasPointerDown({
      button: 0,
      clientX: 140,
      clientY: 160,
    } as PointerEvent);
    fixture.componentInstance.onDocumentPointerUp({
      clientX: 140,
      clientY: 160,
    } as PointerEvent);
    fixture.detectChanges();
    await fixture.whenStable();

    const checklist = fixture.componentInstance.elements.at(-1) as {
      id: string;
      type: 'checklist';
      items: { id: string }[];
    };

    expect(fixture.componentInstance.elements.length).toBe(initialCount + 1);
    expect(checklist.type).toBe('checklist');
    expect(fixture.componentInstance.activeTool).toBe('selection');
    expect(fixture.componentInstance.selectedElementId).toBe(checklist.id);
    expect(fixture.componentInstance.selectedChecklistItemId).toBe(checklist.items[0].id);
    expect(
      fixture.nativeElement.querySelector(
        `#${fixture.componentInstance.checklistEditorId(checklist.id, checklist.items[0].id)}`,
      ),
    ).toBeTruthy();
  });

  it('adds checklist sibling and child items with Enter and Tab', async () => {
    const fixture = await createComponent();

    fixture.componentInstance.setActiveTool('checklist');
    fixture.componentInstance.onCanvasPointerDown({
      button: 0,
      clientX: 140,
      clientY: 160,
    } as PointerEvent);
    fixture.componentInstance.onDocumentPointerUp({
      clientX: 140,
      clientY: 160,
    } as PointerEvent);
    fixture.detectChanges();
    await fixture.whenStable();

    const checklist = fixture.componentInstance.elements.at(-1) as {
      id: string;
      items: { id: string; children: { id: string }[] }[];
    };
    const rootItemId = checklist.items[0].id;
    const preventDefault = jasmine.createSpy('preventDefault');

    fixture.componentInstance.onChecklistItemKeyDown(
      { key: 'Enter', preventDefault } as unknown as KeyboardEvent,
      checklist.id,
      rootItemId,
    );
    fixture.detectChanges();
    await fixture.whenStable();

    const withSibling = fixture.componentInstance.elements.at(-1) as {
      id: string;
      items: { id: string; children: { id: string }[] }[];
    };
    const siblingId = withSibling.items[1].id;

    fixture.componentInstance.onChecklistItemKeyDown(
      { key: 'Tab', preventDefault } as unknown as KeyboardEvent,
      checklist.id,
      siblingId,
    );
    fixture.detectChanges();
    await fixture.whenStable();

    const withChild = fixture.componentInstance.elements.at(-1) as {
      items: { id: string; children: { id: string }[] }[];
    };

    expect(preventDefault).toHaveBeenCalled();
    expect(withSibling.items.length).toBe(2);
    expect(withChild.items[1].children.length).toBe(1);
    expect(fixture.componentInstance.selectedChecklistItemId).toBe(
      withChild.items[1].children[0].id,
    );
    const childEditorId = fixture.componentInstance.checklistEditorId(
      checklist.id,
      withChild.items[1].children[0].id,
    );
    expect(document.activeElement?.id).toBe(childEditorId);
    expect(fixture.nativeElement.querySelector(`#${childEditorId}`)).toBeTruthy();
  });

  it('updates checklist item state and due date from checklist controls', async () => {
    const fixture = await createComponent();

    fixture.componentInstance.setActiveTool('checklist');
    fixture.componentInstance.onCanvasPointerDown({
      button: 0,
      clientX: 140,
      clientY: 160,
    } as PointerEvent);
    fixture.componentInstance.onDocumentPointerUp({
      clientX: 140,
      clientY: 160,
    } as PointerEvent);
    fixture.detectChanges();
    await fixture.whenStable();

    const checklist = fixture.componentInstance.elements.at(-1) as {
      id: string;
      items: { id: string; state: string; dueDate?: string }[];
    };
    const itemId = checklist.items[0].id;

    fixture.componentInstance.cycleChecklistItemState(checklist.id, itemId);
    fixture.componentInstance.updateActiveChecklistDueDate('2026-05-01');
    fixture.detectChanges();

    const updatedChecklist = fixture.componentInstance.elements.at(-1) as {
      items: { state: string; dueDate?: string }[];
    };

    expect(updatedChecklist.items[0].state).toBe('partial');
    expect(updatedChecklist.items[0].dueDate).toBe('2026-05-01');
    expect(fixture.nativeElement.textContent).toContain('Clear date');
  });

  it('deletes a checklist item from its row action', async () => {
    const fixture = await createComponent();

    fixture.componentInstance.setActiveTool('checklist');
    fixture.componentInstance.onCanvasPointerDown({
      button: 0,
      clientX: 140,
      clientY: 160,
    } as PointerEvent);
    fixture.componentInstance.onDocumentPointerUp({
      clientX: 140,
      clientY: 160,
    } as PointerEvent);
    fixture.detectChanges();
    await fixture.whenStable();

    const checklist = fixture.componentInstance.elements.at(-1) as {
      id: string;
      items: { id: string }[];
    };

    fixture.componentInstance.addChecklistSiblingFromToolbar();
    fixture.detectChanges();
    await fixture.whenStable();

    const deleteButtons = fixture.nativeElement.querySelectorAll(
      'button[aria-label="Delete checklist item"]',
    ) as NodeListOf<HTMLButtonElement>;
    deleteButtons[1]?.click();
    fixture.detectChanges();

    const checklistAfterDelete = fixture.componentInstance.elements.at(-1) as {
      items: { id: string }[];
    };

    expect(checklistAfterDelete.items.length).toBe(1);
    expect(checklistAfterDelete.items[0].id).toBe(checklist.items[0].id);
    expect(fixture.componentInstance.selectedChecklistItemId).toBe(checklist.items[0].id);
  });

  it('replaces the last checklist item with a new focused empty item when deleted', async () => {
    const fixture = await createComponent();

    fixture.componentInstance.setActiveTool('checklist');
    fixture.componentInstance.onCanvasPointerDown({
      button: 0,
      clientX: 140,
      clientY: 160,
    } as PointerEvent);
    fixture.componentInstance.onDocumentPointerUp({
      clientX: 140,
      clientY: 160,
    } as PointerEvent);
    fixture.detectChanges();
    await fixture.whenStable();

    const checklist = fixture.componentInstance.elements.at(-1) as {
      id: string;
      items: { id: string; text: string }[];
    };
    const originalItemId = checklist.items[0].id;

    const deleteButton = fixture.nativeElement.querySelector(
      'button[aria-label="Delete checklist item"]',
    ) as HTMLButtonElement;
    deleteButton.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const checklistAfterDelete = fixture.componentInstance.elements.at(-1) as {
      id: string;
      items: { id: string; text: string }[];
    };
    const replacementItem = checklistAfterDelete.items[0];

    expect(replacementItem.id).not.toBe(originalItemId);
    expect(replacementItem.text).toBe('');
    expect(fixture.componentInstance.selectedChecklistItemId).toBe(replacementItem.id);
    expect(document.activeElement?.id).toBe(
      fixture.componentInstance.checklistEditorId(checklistAfterDelete.id, replacementItem.id),
    );
  });

  it('removes empty checklist items when the checklist is unselected', async () => {
    const fixture = await createComponent();

    fixture.componentInstance.setActiveTool('checklist');
    fixture.componentInstance.onCanvasPointerDown({
      button: 0,
      clientX: 140,
      clientY: 160,
    } as PointerEvent);
    fixture.componentInstance.onDocumentPointerUp({
      clientX: 140,
      clientY: 160,
    } as PointerEvent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.addChecklistSiblingFromToolbar();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(
      (fixture.componentInstance.elements.at(-1) as { items: { id: string }[] }).items.length,
    ).toBe(2);

    fixture.componentInstance.setActiveTool('selection');
    fixture.componentInstance.onCanvasPointerDown({
      button: 0,
      clientX: 20,
      clientY: 20,
    } as PointerEvent);
    fixture.componentInstance.onDocumentPointerUp({
      clientX: 20,
      clientY: 20,
    } as PointerEvent);
    fixture.detectChanges();
    await fixture.whenStable();

    const checklistAfterUnselect = fixture.componentInstance.elements.at(-1) as {
      items: { id: string }[];
    };

    expect(checklistAfterUnselect.items.length).toBe(1);
    expect(fixture.componentInstance.selectedElementId).toBeNull();
    expect(fixture.componentInstance.selectedChecklistItemId).toBeNull();
  });

  it('grows checklist height when edited text would overflow the current frame', async () => {
    const fixture = await createComponent();

    fixture.componentInstance.setActiveTool('checklist');
    fixture.componentInstance.onCanvasPointerDown({
      button: 0,
      clientX: 140,
      clientY: 160,
    } as PointerEvent);
    fixture.componentInstance.onDocumentPointerUp({
      clientX: 140,
      clientY: 160,
    } as PointerEvent);
    fixture.detectChanges();
    await fixture.whenStable();

    const checklist = fixture.componentInstance.elements.at(-1) as {
      id: string;
      height: number;
      items: { id: string }[];
    };
    const editor = fixture.nativeElement.querySelector(
      `#${fixture.componentInstance.checklistEditorId(checklist.id, checklist.items[0].id)}`,
    ) as HTMLDivElement;
    editor.innerHTML = 'Wrapped content '.repeat(30);
    fixture.componentInstance.onChecklistItemInput(checklist.id, checklist.items[0].id, {
      target: editor,
    } as unknown as Event);
    fixture.detectChanges();
    await fixture.whenStable();

    const updatedChecklist = fixture.componentInstance.elements.at(-1) as {
      height: number;
    };

    expect(updatedChecklist.height).toBeGreaterThan(checklist.height);
  });

  it('grows checklist height when adding items would overflow the current frame', async () => {
    const fixture = await createComponent();

    fixture.componentInstance.setActiveTool('checklist');
    fixture.componentInstance.onCanvasPointerDown({
      button: 0,
      clientX: 140,
      clientY: 160,
    } as PointerEvent);
    fixture.componentInstance.onDocumentPointerUp({
      clientX: 140,
      clientY: 160,
    } as PointerEvent);
    fixture.detectChanges();
    await fixture.whenStable();

    const checklist = fixture.componentInstance.elements.at(-1) as {
      height: number;
    };

    fixture.componentInstance.addChecklistSiblingFromToolbar();
    fixture.detectChanges();
    await fixture.whenStable();

    const updatedChecklist = fixture.componentInstance.elements.at(-1) as {
      height: number;
    };

    expect(updatedChecklist.height).toBeGreaterThan(checklist.height);
  });

  it('renders checklist bodies with a transparent background', async () => {
    const fixture = await createComponent();

    fixture.componentInstance.setActiveTool('checklist');
    fixture.componentInstance.onCanvasPointerDown({
      button: 0,
      clientX: 140,
      clientY: 160,
    } as PointerEvent);
    fixture.componentInstance.onDocumentPointerUp({
      clientX: 140,
      clientY: 160,
    } as PointerEvent);
    fixture.detectChanges();
    await fixture.whenStable();

    const checklistContainer = fixture.nativeElement.querySelector(
      'foreignObject div.h-full.w-full.rounded',
    ) as HTMLDivElement;

    expect(checklistContainer.className).toContain('bg-transparent');
    expect(checklistContainer.className).not.toContain('bg-theme-bg/95');
  });

  it('removes external text configuration inputs from the editor layout', async () => {
    const fixture = await createComponent();
    fixture.componentInstance.selectedElementId = 't1';
    fixture.detectChanges();
    const selectionRect = fixture.nativeElement.querySelector('svg g g rect');
    const textNode = fixture.nativeElement.querySelector('foreignObject div.select-none');
    const centerCanvasButton = fixture.nativeElement.querySelector(
      'button[aria-label="Center canvas"]',
    );
    const zoomOutButton = fixture.nativeElement.querySelector(
      'button[aria-label="Zoom out to fit"]',
    );
    const canvasGrid = fixture.nativeElement.querySelector('[data-canvas-grid="true"]');

    expect(fixture.nativeElement.querySelector('button[aria-label="Selection tool"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('button[aria-label="Text tool"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('button[aria-label="Checklist tool"]')).toBeTruthy();
    expect(centerCanvasButton).toBeTruthy();
    expect(zoomOutButton).toBeTruthy();
    expect(canvasGrid?.parentElement?.tagName.toLowerCase()).toBe('g');
    expect(selectionRect.getAttribute('stroke-dasharray')).toBe('8 6');
    expect(textNode.style.cursor).toBe('move');
    expect(fixture.nativeElement.textContent).not.toContain('Selected text');
    expect(fixture.nativeElement.textContent).not.toContain('Width');
  });
});
