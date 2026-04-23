import { Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AttachmentPreviewService } from './attachment-preview.service';

@Injectable()
class TestAttachmentPreviewService extends AttachmentPreviewService {
  override loadDocxPreviewModule(): ReturnType<AttachmentPreviewService['loadDocxPreviewModule']> {
    return super.loadDocxPreviewModule();
  }

  override loadExcelJsModule(): ReturnType<AttachmentPreviewService['loadExcelJsModule']> {
    return super.loadExcelJsModule();
  }
}

describe('AttachmentPreviewService', () => {
  let service: TestAttachmentPreviewService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: AttachmentPreviewService, useClass: TestAttachmentPreviewService }],
    });
    service = TestBed.inject(AttachmentPreviewService) as TestAttachmentPreviewService;
  });

  it('renders DOCX previews when the filename extension matches', async () => {
    spyOn(service, 'loadDocxPreviewModule').and.returnValue(
      Promise.resolve({
        renderAsync: async (
          _data: ArrayBuffer,
          bodyContainer: HTMLElement,
          styleContainer?: HTMLElement,
        ) => {
          bodyContainer.innerHTML = '<article>Quarterly review</article>';
          styleContainer?.insertAdjacentHTML(
            'beforeend',
            '<style>.raz-docx-preview{font-weight:700;}</style>',
          );
        },
      }),
    );

    const preview = await service.createPreview(
      {
        id: 'docx-1',
        name: 'proposal.docx',
        type: '',
        size: 12,
      },
      new Blob(['demo'], { type: 'application/octet-stream' }),
      { compact: false },
    );

    expect(preview.mode).toBe('html');
    if (preview.mode !== 'html') {
      fail('Expected a rendered DOCX preview.');
      return;
    }

    expect(preview.category).toBe('docx');
    expect(preview.summary).toContain('DOCX');
    expect(preview.html).toContain('Quarterly review');
    expect(preview.html).toContain('raz-docx-preview');
  });

  it('renders workbook previews with merged cells and sheet selection metadata', async () => {
    spyOn(service, 'loadExcelJsModule').and.returnValue(
      Promise.resolve({
        Workbook: FakeWorkbook as unknown as typeof import('exceljs').Workbook,
      }),
    );

    const preview = await service.createPreview(
      {
        id: 'xlsx-1',
        name: 'budget.xlsx',
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 64,
      },
      new Blob(['demo'], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      { compact: false },
    );

    expect(preview.mode).toBe('workbook');
    if (preview.mode !== 'workbook') {
      fail('Expected a rendered workbook preview.');
      return;
    }

    expect(preview.category).toBe('xlsx');
    expect(preview.sheets.length).toBe(2);
    expect(preview.activeSheetIndex).toBe(1);
    expect(preview.sheets[0].html).toContain('Revenue');
    expect(preview.sheets[0].html).toContain('colspan="2"');
    expect(preview.sheets[0].summary).toContain('frozen row');
    expect(preview.summary).toContain('2 sheets');
  });

  it('falls back when the DOCX renderer fails', async () => {
    spyOn(service, 'loadDocxPreviewModule').and.returnValue(Promise.reject(new Error('boom')));

    const preview = await service.createPreview(
      {
        id: 'docx-2',
        name: 'broken.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 8,
      },
      new Blob(['broken'], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      { compact: true },
    );

    expect(preview.mode).toBe('fallback');
    if (preview.mode !== 'fallback') {
      fail('Expected a fallback preview.');
      return;
    }

    expect(preview.category).toBe('docx');
    expect(preview.message).toContain('DOCX preview');
  });
});

class FakeWorkbook {
  readonly views = [{ activeTab: 1 }];
  readonly worksheets = [createSummaryWorksheet(), createDetailsWorksheet()];
  readonly xlsx = {
    load: async (buffer: ArrayBuffer) => {
      void buffer;
      return this as unknown as import('exceljs').Workbook;
    },
  };
}

function createSummaryWorksheet(): import('exceljs').Worksheet {
  const cells = new Map<string, Partial<import('exceljs').Cell>>([
    [
      '1:1',
      {
        text: 'Revenue',
        font: { bold: true, color: { argb: 'FF1D4ED8' } },
      },
    ],
    ['2:1', { text: '42' }],
    ['2:2', { text: '84' }],
  ]);

  return createWorksheet({
    cells,
    dimensions: { bottom: 2, left: 1, right: 2, top: 1 },
    id: 1,
    merges: ['A1:B1'],
    name: 'Summary',
    views: [{ state: 'frozen', ySplit: 1 }],
  });
}

function createDetailsWorksheet(): import('exceljs').Worksheet {
  const cells = new Map<string, Partial<import('exceljs').Cell>>([
    ['1:1', { text: 'North' }],
    ['1:2', { text: 'South' }],
  ]);

  return createWorksheet({
    cells,
    dimensions: { bottom: 1, left: 1, right: 2, top: 1 },
    id: 2,
    name: 'Details',
    views: [],
  });
}

function createWorksheet(input: {
  cells: Map<string, Partial<import('exceljs').Cell>>;
  dimensions: { bottom: number; left: number; right: number; top: number };
  id: number;
  merges?: string[];
  name: string;
  views: Partial<import('exceljs').WorksheetView>[];
}): import('exceljs').Worksheet {
  return {
    columnCount: input.dimensions.right,
    dimensions: input.dimensions,
    getCell: (rowNumber: number, columnNumber: number) =>
      ({
        alignment: undefined,
        border: undefined,
        fill: undefined,
        font: undefined,
        formula: '',
        hyperlink: '',
        result: undefined,
        text: '',
        value: undefined,
        ...input.cells.get(`${rowNumber}:${columnNumber}`),
      }) as import('exceljs').Cell,
    getColumn: (columnNumber: number) => {
      void columnNumber;
      return {
        alignment: undefined,
        border: undefined,
        fill: undefined,
        font: undefined,
        hidden: false,
        width: 12,
      } as import('exceljs').Column;
    },
    getRow: (rowNumber: number) => {
      void rowNumber;
      return {
        alignment: undefined,
        border: undefined,
        fill: undefined,
        font: undefined,
        height: undefined,
        hidden: false,
      } as unknown as import('exceljs').Row;
    },
    id: input.id,
    model: {
      merges: input.merges ?? [],
    },
    name: input.name,
    rowCount: input.dimensions.bottom,
    state: 'visible',
    views: input.views,
  } as unknown as import('exceljs').Worksheet;
}
