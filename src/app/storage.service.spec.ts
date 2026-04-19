import { TestBed } from '@angular/core/testing';
import { LEGACY_STORAGE_KEY, Note, StorageService } from './storage.service';

// ── OPFS mock helpers ─────────────────────────────────────────────────────────

interface MockWritable {
  write: jasmine.Spy;
  close: jasmine.Spy;
  _data: ArrayBuffer | string;
}

function createMockWritable(): MockWritable {
  const w: MockWritable = {
    _data: '',
    write: jasmine.createSpy('write').and.callFake(async (chunk: ArrayBuffer | string) => {
      w._data = chunk;
    }),
    close: jasmine.createSpy('close').and.returnValue(Promise.resolve())
  };
  return w;
}

interface MockFileHandle {
  handle: FileSystemFileHandle;
  writable: MockWritable;
}

function createMockFileHandle(initialContent = ''): MockFileHandle {
  let content = initialContent;
  const writable = createMockWritable();
  // Capture writes so getFile() returns the latest written content
  writable.write.and.callFake(async (chunk: ArrayBuffer | string) => {
    writable._data = chunk;
    content = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
  });

  const handle = {
    getFile: jasmine.createSpy('getFile').and.callFake(async () => {
      return new File([content], 'file');
    }),
    createWritable: jasmine.createSpy('createWritable').and.returnValue(
      Promise.resolve(writable as unknown as FileSystemWritableFileStream)
    )
  } as unknown as FileSystemFileHandle;

  return { handle, writable };
}

interface MockDirHandle {
  handle: FileSystemDirectoryHandle;
  files: Map<string, MockFileHandle>;
  subdirs: Map<string, MockDirHandle>;
}

function createMockDirHandle(): MockDirHandle {
  const files = new Map<string, MockFileHandle>();
  const subdirs = new Map<string, MockDirHandle>();

  const handle = {
    getFileHandle: jasmine
      .createSpy('getFileHandle')
      .and.callFake(async (name: string, opts?: FileSystemGetFileOptions) => {
        if (!files.has(name)) {
          if (opts?.create) {
            const fh = createMockFileHandle();
            files.set(name, fh);
            return fh.handle;
          }
          throw new DOMException('Not found', 'NotFoundError');
        }
        return files.get(name)!.handle;
      }),
    getDirectoryHandle: jasmine
      .createSpy('getDirectoryHandle')
      .and.callFake(async (name: string, opts?: FileSystemGetDirectoryOptions) => {
        if (!subdirs.has(name)) {
          if (opts?.create) {
            const dh = createMockDirHandle();
            subdirs.set(name, dh);
            return dh.handle;
          }
          throw new DOMException('Not found', 'NotFoundError');
        }
        return subdirs.get(name)!.handle;
      }),
    removeEntry: jasmine.createSpy('removeEntry').and.returnValue(Promise.resolve())
  } as unknown as FileSystemDirectoryHandle;

  return { handle, files, subdirs };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('StorageService', () => {
  let service: StorageService;
  let root: MockDirHandle;

  beforeEach(() => {
    root = createMockDirHandle();
    spyOn(navigator.storage, 'getDirectory').and.returnValue(
      Promise.resolve(root.handle)
    );
    localStorage.clear();

    TestBed.configureTestingModule({});
    service = TestBed.inject(StorageService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('init()', () => {
    it('returns empty array when no index file exists', async () => {
      const notes = await service.init();
      expect(notes).toEqual([]);
    });

    it('reads notes from existing index file', async () => {
      const stored: Note[] = [
        { id: 1, kind: 'text', title: 'Hello', text: 'World', createdAt: '2024-01-01T00:00:00.000Z', attachments: [] }
      ];
      root.files.set('notes-index.json', createMockFileHandle(JSON.stringify(stored)));

      const notes = await service.init();
      expect(notes.length).toBe(1);
      expect(notes[0].title).toBe('Hello');
    });

    it('back-fills missing attachments array when loading legacy index', async () => {
      const legacyStored = [
        { id: 1, kind: 'text', title: 'Old', text: 'Note', createdAt: '2024-01-01T00:00:00.000Z' }
      ];
      root.files.set('notes-index.json', createMockFileHandle(JSON.stringify(legacyStored)));

      const notes = await service.init();
      expect(notes[0].attachments).toEqual([]);
    });

    it('migrates notes from localStorage when OPFS index is empty', async () => {
      const legacy = [
        { id: 2, kind: 'todo', title: 'Legacy', todos: ['a', 'b'], createdAt: '2024-01-01T00:00:00.000Z' }
      ];
      localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(legacy));

      const notes = await service.init();

      expect(notes.length).toBe(1);
      expect(notes[0].title).toBe('Legacy');
      expect(notes[0].attachments).toEqual([]);
      expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
    });

    it('does not migrate from localStorage when OPFS already has notes', async () => {
      const existing: Note[] = [
        { id: 3, kind: 'text', title: 'Existing', text: 'x', createdAt: '2024-01-01T00:00:00.000Z', attachments: [] }
      ];
      root.files.set('notes-index.json', createMockFileHandle(JSON.stringify(existing)));
      localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify([{ id: 99, kind: 'text', title: 'Skip', text: 'y', createdAt: '2024-01-01T00:00:00.000Z' }]));

      const notes = await service.init();

      expect(notes.length).toBe(1);
      expect(notes[0].title).toBe('Existing');
      expect(localStorage.getItem(LEGACY_STORAGE_KEY)).not.toBeNull();
    });
  });

  describe('saveIndex()', () => {
    it('writes serialised notes to notes-index.json', async () => {
      await service.init();

      const notes: Note[] = [
        { id: 1, kind: 'text', title: 'T', text: 'B', createdAt: '2024-01-01T00:00:00.000Z', attachments: [] }
      ];
      await service.saveIndex(notes);

      const fh = root.files.get('notes-index.json')!;
      expect(fh).toBeDefined();
      expect(fh.handle.createWritable).toHaveBeenCalled();
      expect(fh.writable.write).toHaveBeenCalledWith(JSON.stringify(notes));
      expect(fh.writable.close).toHaveBeenCalled();
    });
  });

  describe('writeAttachment()', () => {
    it('creates a per-note subdirectory and writes the file', async () => {
      await service.init();

      const attachment = { id: 'att-abc', name: 'photo.png', type: 'image/png', size: 42 };
      const file = new File(['pixel'], 'photo.png', { type: 'image/png' });

      await service.writeAttachment(7, attachment, file);

      // A subdirectory named "7" should have been created
      expect(root.handle.getDirectoryHandle).toHaveBeenCalledWith('7', { create: true });

      const noteDir = root.subdirs.get('7')!;
      expect(noteDir).toBeDefined();
      expect(noteDir.handle.getFileHandle).toHaveBeenCalledWith('att-abc', { create: true });
    });
  });

  describe('readAttachment()', () => {
    it('returns a Blob with the provided MIME type', async () => {
      await service.init();

      const noteDir = createMockDirHandle();
      noteDir.files.set('att-xyz', createMockFileHandle('hello'));
      root.subdirs.set('5', noteDir);

      const blob = await service.readAttachment(5, 'att-xyz', 'text/plain');

      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('text/plain');
    });
  });

  describe('deleteNote()', () => {
    it('removes the note directory via removeEntry', async () => {
      await service.init();
      await service.deleteNote(42);
      expect(root.handle.removeEntry).toHaveBeenCalledWith('42', { recursive: true });
    });

    it('does not throw when the note has no attachment directory', async () => {
      (root.handle.removeEntry as jasmine.Spy).and.returnValue(
        Promise.reject(new DOMException('Not found', 'NotFoundError'))
      );
      await service.init();
      await expectAsync(service.deleteNote(99)).toBeResolved();
    });
  });
});
