import { TestBed } from '@angular/core/testing';

import { NoteArchiveService } from './note-archive.service';
import { Note } from './storage.service';

describe('NoteArchiveService', () => {
  let service: NoteArchiveService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(NoteArchiveService);
  });

  it('exports and imports a note archive with attachments', async () => {
    const note: Note = {
      id: 7,
      title: 'Archive me',
      createdAt: '2026-05-06T00:00:00.000Z',
      lastModifiedAt: '2026-05-06T01:00:00.000Z',
      elements: [
        { id: 't1', text: 'Body', x: 0, y: 0, width: 180, fontSize: 24 },
        {
          id: 'a-el-1',
          type: 'attachment',
          attachmentId: 'a1',
          x: 220,
          y: 10,
          width: 240,
          height: 180,
        },
      ],
      attachments: [{ id: 'a1', name: 'file.txt', type: 'text/plain', size: 4 }],
    };
    const archive = await service.exportNote(note, new Map([['a1', new Blob(['demo'])]]));

    const imported = await service.importNote(archive);

    expect(imported.note.title).toBe('Archive me');
    expect(imported.note.createdAt).toBe(note.createdAt);
    expect(imported.note.lastModifiedAt).toBe(note.lastModifiedAt);
    expect(imported.note.attachments).toEqual(note.attachments);
    expect(imported.attachmentFiles[0]?.attachmentId).toBe('a1');
    expect(await imported.attachmentFiles[0]?.file.text()).toBe('demo');
  });

  it('inspects the title from an archive manifest', async () => {
    const archive = await service.exportNote(
      {
        id: 7,
        title: 'Peek',
        createdAt: '2026-05-06T00:00:00.000Z',
        lastModifiedAt: '2026-05-06T01:00:00.000Z',
        elements: [],
        attachments: [],
      },
      new Map(),
    );

    await expectAsync(service.inspectArchive(archive)).toBeResolvedTo({ title: 'Peek' });
  });

  it('rejects archives missing attachment bytes for referenced attachment metadata', async () => {
    const archive = await service.exportNote(
      {
        id: 7,
        title: 'Broken',
        createdAt: '2026-05-06T00:00:00.000Z',
        lastModifiedAt: '2026-05-06T01:00:00.000Z',
        elements: [],
        attachments: [{ id: 'a1', name: 'file.txt', type: 'text/plain', size: 4 }],
      },
      new Map([['a1', new Blob(['demo'])]]),
    );

    const zipBuffer = await archive.arrayBuffer();
    const truncated = new Uint8Array(zipBuffer.slice(0));
    // Corrupt the zip by removing the attachment bytes file entry from a second pass through JSZip.
    const JSZipModule = (await import('jszip')).default;
    const zip = await JSZipModule.loadAsync(truncated);
    zip.remove('attachments/a1');
    const brokenArchive = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });

    await expectAsync(service.importNote(brokenArchive)).toBeRejectedWithError(
      'Archive is missing attachment data for "file.txt".',
    );
  });
});
