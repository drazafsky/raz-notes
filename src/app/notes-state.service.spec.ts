import { TestBed } from '@angular/core/testing';

import { NotesStateService } from './notes-state.service';
import { Note, StorageService } from './storage.service';

describe('NotesStateService', () => {
  let service: NotesStateService;
  let storage: jasmine.SpyObj<StorageService>;

  beforeEach(() => {
    storage = jasmine.createSpyObj<StorageService>('StorageService', [
      'loadNotes',
      'saveNotes',
      'writeAttachment',
      'deleteNote'
    ]);
    storage.loadNotes.and.returnValue(Promise.resolve([]));
    storage.saveNotes.and.returnValue(Promise.resolve());
    storage.writeAttachment.and.returnValue(Promise.resolve());
    storage.deleteNote.and.returnValue(Promise.resolve());

    TestBed.configureTestingModule({
      providers: [{ provide: StorageService, useValue: storage }]
    });

    service = TestBed.inject(NotesStateService);
  });

  it('loads notes from storage', async () => {
    const note: Note = {
      id: 1,
      kind: 'text',
      title: 'Saved',
      text: 'Persisted',
      createdAt: '2026-04-19T00:00:00.000Z',
      lastModifiedAt: '2026-04-19T00:00:00.000Z',
      attachments: []
    };
    storage.loadNotes.and.returnValue(Promise.resolve([note]));

    await service.load();

    expect(service.notes()).toEqual([note]);
  });

  it('creates a note with matching created and modified timestamps', async () => {
    const created = await service.createNote(
      { kind: 'text', title: 'New note', text: 'Body' },
      []
    );

    expect(created.createdAt).toBe(created.lastModifiedAt);
    expect(service.notes()[0].title).toBe('New note');
    expect(storage.saveNotes).toHaveBeenCalled();
  });

  it('updates a note and refreshes the modified timestamp', async () => {
    const existing: Note = {
      id: 2,
      kind: 'text',
      title: 'Original',
      text: 'Before',
      createdAt: '2026-04-19T00:00:00.000Z',
      lastModifiedAt: '2026-04-19T00:00:00.000Z',
      attachments: []
    };
    service.notes.set([existing]);

    const updated = await service.updateNote(2, {
      kind: 'todo',
      title: 'Updated',
      todos: ['One', 'Two']
    });

    expect(updated.kind).toBe('todo');
    expect(updated.lastModifiedAt >= existing.lastModifiedAt).toBeTrue();
    expect(service.notes()[0].title).toBe('Updated');
  });
});
