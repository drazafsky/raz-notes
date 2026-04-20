import { TestBed } from '@angular/core/testing';

import { AuthRecord } from './crypto.utils';
import { Note, StorageService } from './storage.service';

interface MockWritable {
  write: jasmine.Spy;
  close: jasmine.Spy;
  _data: ArrayBuffer | string;
}

function createMockWritable(): MockWritable {
  const writable: MockWritable = {
    _data: '',
    write: jasmine.createSpy('write').and.callFake(async (chunk: ArrayBuffer | string) => {
      writable._data = chunk;
    }),
    close: jasmine.createSpy('close').and.returnValue(Promise.resolve()),
  };

  return writable;
}

interface MockFileHandle {
  handle: FileSystemFileHandle;
  writable: MockWritable;
}

function createMockFileHandle(initialContent = ''): MockFileHandle {
  let content = initialContent;
  const writable = createMockWritable();

  writable.write.and.callFake(async (chunk: ArrayBuffer | string) => {
    writable._data = chunk;
    content = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
  });

  const handle = {
    getFile: jasmine.createSpy('getFile').and.callFake(async () => new File([content], 'file')),
    createWritable: jasmine
      .createSpy('createWritable')
      .and.returnValue(Promise.resolve(writable as unknown as FileSystemWritableFileStream)),
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
            const fileHandle = createMockFileHandle();
            files.set(name, fileHandle);
            return fileHandle.handle;
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
            const dirHandle = createMockDirHandle();
            subdirs.set(name, dirHandle);
            return dirHandle.handle;
          }

          throw new DOMException('Not found', 'NotFoundError');
        }

        return subdirs.get(name)!.handle;
      }),
    removeEntry: jasmine.createSpy('removeEntry').and.callFake(async (name: string) => {
      if (files.delete(name) || subdirs.delete(name)) {
        return;
      }

      throw new DOMException('Not found', 'NotFoundError');
    }),
  } as unknown as FileSystemDirectoryHandle;

  return { handle, files, subdirs };
}

describe('StorageService', () => {
  let service: StorageService;
  let root: MockDirHandle;
  let vaultKey: CryptoKey;

  beforeEach(async () => {
    root = createMockDirHandle();
    spyOn(navigator.storage, 'getDirectory').and.returnValue(Promise.resolve(root.handle));

    TestBed.configureTestingModule({});
    service = TestBed.inject(StorageService);
    vaultKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('returns null when no auth record exists', async () => {
    await service.init();

    await expectAsync(service.readAuthRecord()).toBeResolvedTo(null);
  });

  it('writes and reads a stored auth record', async () => {
    const record: AuthRecord = {
      version: 1,
      username: 'Alice',
      normalizedUsername: 'alice',
      salt: 'salt',
      iv: 'iv',
      wrappedVaultKey: 'wrapped',
      iterations: 123,
      createdAt: '2026-04-19T00:00:00.000Z',
    };

    await service.saveAuthRecord(record);

    await expectAsync(service.readAuthRecord()).toBeResolvedTo(record);
  });

  it('encrypts notes at rest and decrypts them after unlock', async () => {
    const notes: Note[] = [
      {
        id: 1,
        title: 'Secret',
        elements: [{ id: 't1', text: 'Top secret note', x: 0, y: 0, width: 180, fontSize: 24 }],
        createdAt: '2026-04-19T00:00:00.000Z',
        lastModifiedAt: '2026-04-19T00:00:00.000Z',
        attachments: [],
      },
    ];

    service.setVaultKey(vaultKey);
    await service.saveNotes(notes);

    const stored = root.files.get('notes-vault.json');
    expect(stored).toBeDefined();
    expect(stored!.writable._data).not.toContain('Top secret note');

    const loadedNotes = await service.loadNotes();

    expect(loadedNotes).toEqual([
      jasmine.objectContaining({
        ...notes[0],
        elements: [
          jasmine.objectContaining({
            ...notes[0].elements[0],
            height: jasmine.any(Number),
          }),
        ],
      }),
    ]);
  });

  it('encrypts attachments and can read them back after unlock', async () => {
    service.setVaultKey(vaultKey);

    const attachment = { id: 'att-1', name: 'hello.txt', type: 'text/plain', size: 5 };
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });

    await service.writeAttachment(7, attachment, file);
    const blob = await service.readAttachment(7, 'att-1', 'text/plain');

    expect(await blob.text()).toBe('hello');
    expect(root.subdirs.get('vault-attachments')).toBeDefined();
  });

  it('migrates legacy plaintext notes and attachments into the encrypted vault', async () => {
    const notes: Note[] = [
      {
        id: 5,
        title: 'Legacy',
        elements: [{ id: 't1', text: 'Needs migration', x: 0, y: 0, width: 180, fontSize: 24 }],
        createdAt: '2026-04-19T00:00:00.000Z',
        lastModifiedAt: '2026-04-19T00:00:00.000Z',
        attachments: [{ id: 'att-legacy', name: 'legacy.txt', type: 'text/plain', size: 6 }],
      },
    ];
    root.files.set('notes-index.json', createMockFileHandle(JSON.stringify(notes)));
    const noteDir = createMockDirHandle();
    noteDir.files.set('att-legacy', createMockFileHandle('secret'));
    root.subdirs.set('5', noteDir);

    service.setVaultKey(vaultKey);

    const loadedNotes = await service.loadNotes();

    expect(loadedNotes).toEqual([
      jasmine.objectContaining({
        ...notes[0],
        elements: [
          jasmine.objectContaining({
            ...notes[0].elements[0],
            height: jasmine.any(Number),
          }),
        ],
      }),
    ]);
    const blob = await service.readAttachment(5, 'att-legacy', 'text/plain');

    expect(await blob.text()).toBe('secret');
    expect(root.files.has('notes-index.json')).toBeFalse();
    expect(root.files.has('notes-vault.json')).toBeTrue();
    expect(root.subdirs.has('5')).toBeFalse();
  });

  it('deletes the encrypted attachment directory for a note', async () => {
    service.setVaultKey(vaultKey);

    const attachment = { id: 'att-1', name: 'hello.txt', type: 'text/plain', size: 5 };
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
    await service.writeAttachment(42, attachment, file);

    await service.deleteNote(42);

    const attachmentsRoot = root.subdirs.get('vault-attachments')!;
    expect(attachmentsRoot.subdirs.has('42')).toBeFalse();
  });
});
