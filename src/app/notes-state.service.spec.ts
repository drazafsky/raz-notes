import { TestBed } from '@angular/core/testing';

import { AuthService } from './auth.service';
import { NotesStateService, PendingAttachment } from './notes-state.service';
import { Note, NoteAttachmentElement, NoteTextElement, StorageService } from './storage.service';

describe('NotesStateService', () => {
  let service: NotesStateService;
  let storage: jasmine.SpyObj<StorageService>;
  let auth: jasmine.SpyObj<AuthService>;

  beforeEach(() => {
    storage = jasmine.createSpyObj<StorageService>('StorageService', [
      'loadNotes',
      'saveNotes',
      'writeAttachment',
      'deleteNote',
      'deleteAttachment',
    ]);
    storage.loadNotes.and.returnValue(Promise.resolve([]));
    storage.saveNotes.and.returnValue(Promise.resolve());
    storage.writeAttachment.and.returnValue(Promise.resolve());
    storage.deleteNote.and.returnValue(Promise.resolve());
    storage.deleteAttachment.and.returnValue(Promise.resolve());
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['recordActivity']);

    TestBed.configureTestingModule({
      providers: [
        { provide: StorageService, useValue: storage },
        { provide: AuthService, useValue: auth },
      ],
    });

    service = TestBed.inject(NotesStateService);
  });

  it('loads notes from storage', async () => {
    const note: Note = {
      id: 1,
      title: 'Saved',
      elements: [{ id: 't1', text: 'Persisted', x: 0, y: 0, width: 180, fontSize: 24 }],
      createdAt: '2026-04-19T00:00:00.000Z',
      lastModifiedAt: '2026-04-19T00:00:00.000Z',
      attachments: [],
    };
    storage.loadNotes.and.returnValue(Promise.resolve([note]));

    await service.load();

    expect(service.notes()).toEqual([note]);
  });

  it('creates a note with matching created and modified timestamps', async () => {
    const created = await service.createNote(
      {
        title: 'New note',
        elements: [{ id: 't1', text: 'Body', x: 0, y: 0, width: 180, fontSize: 24 }],
      },
      [],
    );

    expect(created.createdAt).toBe(created.lastModifiedAt);
    expect(service.notes()[0].title).toBe('New note');
    expect(storage.saveNotes).toHaveBeenCalled();
    expect(auth.recordActivity).toHaveBeenCalled();
  });

  it('updates a note and refreshes the modified timestamp', async () => {
    const existing: Note = {
      id: 2,
      title: 'Original',
      elements: [{ id: 't1', text: 'Before', x: 0, y: 0, width: 180, fontSize: 24 }],
      createdAt: '2026-04-19T00:00:00.000Z',
      lastModifiedAt: '2026-04-19T00:00:00.000Z',
      attachments: [],
    };
    service.notes.set([existing]);

    const updated = await service.updateNote(2, {
      title: 'Updated',
      elements: [{ id: 't2', text: 'Updated', x: 10, y: 20, width: 220, fontSize: 28 }],
    });

    expect((updated.elements[0] as NoteTextElement).text).toBe('Updated');
    expect((updated.elements[0] as NoteTextElement).fontSize).toBe(28);
    expect(updated.lastModifiedAt >= existing.lastModifiedAt).toBeTrue();
    expect(service.notes()[0].title).toBe('Updated');
    expect(auth.recordActivity).toHaveBeenCalled();
  });

  it('adds referenced pending attachments when updating a note', async () => {
    const existing: Note = {
      id: 4,
      title: 'Attachment note',
      elements: [{ id: 't1', text: 'Before', x: 0, y: 0, width: 180, fontSize: 24 }],
      createdAt: '2026-04-19T00:00:00.000Z',
      lastModifiedAt: '2026-04-19T00:00:00.000Z',
      attachments: [],
    };
    const attachment = { id: 'a2', name: 'demo.pdf', type: 'application/pdf', size: 12 };
    const pendingAttachment: PendingAttachment = {
      attachment,
      file: new File(['demo'], 'demo.pdf', { type: 'application/pdf' }),
    };
    service.notes.set([existing]);

    const updated = await service.updateNote(
      4,
      {
        title: 'Attachment note',
        elements: [
          {
            id: 'att-1',
            type: 'attachment',
            attachmentId: 'a2',
            x: 10,
            y: 20,
            width: 240,
            height: 180,
          } satisfies NoteAttachmentElement,
        ],
      },
      [pendingAttachment],
    );

    expect(updated.attachments).toEqual([attachment]);
    expect(storage.writeAttachment).toHaveBeenCalledWith(4, attachment, pendingAttachment.file);
  });

  it('deletes storage for removed referenced attachment elements during update', async () => {
    const existing: Note = {
      id: 5,
      title: 'Attachment note',
      elements: [
        {
          id: 'att-1',
          type: 'attachment',
          attachmentId: 'a1',
          x: 10,
          y: 20,
          width: 240,
          height: 180,
        } satisfies NoteAttachmentElement,
      ],
      createdAt: '2026-04-19T00:00:00.000Z',
      lastModifiedAt: '2026-04-19T00:00:00.000Z',
      attachments: [{ id: 'a1', name: 'file.txt', type: 'text/plain', size: 4 }],
    };
    service.notes.set([existing]);

    const updated = await service.updateNote(5, {
      title: 'Attachment note',
      elements: [{ id: 't1', text: 'Replacement', x: 0, y: 0, width: 180, fontSize: 24 }],
    });

    expect(updated.attachments).toEqual([]);
    expect(storage.deleteAttachment).toHaveBeenCalledWith(5, 'a1');
  });

  it('deletes an attachment from an existing note', async () => {
    const existing: Note = {
      id: 3,
      title: 'With attachment',
      elements: [{ id: 't1', text: 'Body', x: 0, y: 0, width: 180, fontSize: 24 }],
      createdAt: '2026-04-19T00:00:00.000Z',
      lastModifiedAt: '2026-04-19T00:00:00.000Z',
      attachments: [{ id: 'a1', name: 'file.txt', type: 'text/plain', size: 4 }],
    };
    service.notes.set([existing]);

    const updated = await service.deleteAttachment(3, 'a1');

    expect(updated.attachments).toEqual([]);
    expect(storage.deleteAttachment).toHaveBeenCalledWith(3, 'a1');
    expect(auth.recordActivity).toHaveBeenCalled();
  });
});
