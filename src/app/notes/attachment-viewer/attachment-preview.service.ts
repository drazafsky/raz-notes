import { Injectable } from '@angular/core';

import { Attachment } from '../storage.service';

type NativeAttachmentCategory = 'image' | 'video' | 'audio' | 'pdf';
export type AttachmentPreviewCategory = NativeAttachmentCategory | 'docx' | 'xlsx' | 'other';

export interface AttachmentPreviewOptions {
  compact: boolean;
}

export interface HtmlAttachmentPreview {
  mode: 'html';
  category: 'docx';
  html: string;
  summary: string;
}

export interface WorkbookPreviewSheet {
  id: string;
  name: string;
  html: string;
  summary: string;
}

export interface WorkbookAttachmentPreview {
  mode: 'workbook';
  category: 'xlsx';
  summary: string;
  sheets: WorkbookPreviewSheet[];
  activeSheetIndex: number;
}

export interface NativeAttachmentPreview {
  mode: 'native';
  category: NativeAttachmentCategory;
}

export interface FallbackAttachmentPreview {
  mode: 'fallback';
  category: AttachmentPreviewCategory;
  message: string;
}

export type AttachmentPreview =
  | FallbackAttachmentPreview
  | HtmlAttachmentPreview
  | NativeAttachmentPreview
  | WorkbookAttachmentPreview;

type DocxPreviewModule = Pick<typeof import('docx-preview'), 'renderAsync'>;
type ExcelJsModule = Pick<typeof import('exceljs'), 'Workbook'>;
type ExcelJsWorkbook = import('exceljs').Workbook;
type ExcelJsWorksheet = import('exceljs').Worksheet;
type ExcelJsCell = import('exceljs').Cell;
type ExcelJsColumn = import('exceljs').Column;
type ExcelJsRow = import('exceljs').Row;
type ExcelJsView = Partial<import('exceljs').WorksheetView>;

interface MergePreviewMap {
  hiddenAddresses: Set<string>;
  spansByAddress: Map<string, { colSpan: number; rowSpan: number }>;
}

const DOCX_EXTENSIONS = new Set(['docx']);
const DOCX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const XLSX_EXTENSIONS = new Set(['xlsx', 'xlsm']);
const XLSX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroenabled.12',
]);
const FULL_PREVIEW_MAX_COLUMNS = 18;
const FULL_PREVIEW_MAX_ROWS = 80;
const COMPACT_PREVIEW_MAX_COLUMNS = 8;
const COMPACT_PREVIEW_MAX_ROWS = 14;
const PREVIEW_CELL_MAX_TEXT_LENGTH = 240;

@Injectable({ providedIn: 'root' })
export class AttachmentPreviewService {
  async createPreview(
    attachment: Attachment,
    blob: Blob,
    options: AttachmentPreviewOptions,
  ): Promise<AttachmentPreview> {
    const category = this.detectCategory(attachment);
    switch (category) {
      case 'image':
      case 'video':
      case 'audio':
      case 'pdf':
        return { mode: 'native', category };
      case 'docx':
        return this.createDocxPreview(blob, options);
      case 'xlsx':
        return this.createWorkbookPreview(blob, options);
      default:
        return {
          mode: 'fallback',
          category,
          message: 'Preview unavailable for this file type.',
        };
    }
  }

  protected loadDocxPreviewModule(): Promise<DocxPreviewModule> {
    return import('docx-preview');
  }

  protected loadExcelJsModule(): Promise<ExcelJsModule> {
    return import('exceljs');
  }

  private detectCategory(attachment: Attachment): AttachmentPreviewCategory {
    const mimeType = attachment.type.trim().toLowerCase();
    const extension = this.fileExtension(attachment.name);

    if (mimeType.startsWith('image/')) {
      return 'image';
    }
    if (mimeType.startsWith('video/')) {
      return 'video';
    }
    if (mimeType.startsWith('audio/')) {
      return 'audio';
    }
    if (mimeType === 'application/pdf' || extension === 'pdf') {
      return 'pdf';
    }
    if (DOCX_MIME_TYPES.has(mimeType) || DOCX_EXTENSIONS.has(extension)) {
      return 'docx';
    }
    if (XLSX_MIME_TYPES.has(mimeType) || XLSX_EXTENSIONS.has(extension)) {
      return 'xlsx';
    }
    return 'other';
  }

  private async createDocxPreview(
    blob: Blob,
    options: AttachmentPreviewOptions,
  ): Promise<AttachmentPreview> {
    try {
      const { renderAsync } = await this.loadDocxPreviewModule();
      const bodyContainer = document.createElement('div');
      const styleContainer = document.createElement('div');
      await renderAsync(await blob.arrayBuffer(), bodyContainer, styleContainer, {
        breakPages: !options.compact,
        className: 'raz-docx-preview',
        hideWrapperOnPrint: true,
        ignoreHeight: options.compact,
        ignoreLastRenderedPageBreak: false,
        ignoreWidth: options.compact,
        inWrapper: !options.compact,
        renderFooters: !options.compact,
        renderHeaders: !options.compact,
        useBase64URL: true,
      });
      const html = `${styleContainer.innerHTML}${bodyContainer.innerHTML}`.trim();
      if (!html) {
        throw new Error('Rendered document preview was empty.');
      }
      return {
        mode: 'html',
        category: 'docx',
        html,
        summary: options.compact ? 'DOCX preview' : 'Higher-fidelity DOCX preview',
      };
    } catch {
      return {
        mode: 'fallback',
        category: 'docx',
        message: 'DOCX preview could not be generated in the browser.',
      };
    }
  }

  private async createWorkbookPreview(
    blob: Blob,
    options: AttachmentPreviewOptions,
  ): Promise<AttachmentPreview> {
    try {
      const { Workbook } = await this.loadExcelJsModule();
      const workbook = new Workbook();
      const workbookBuffer = (await blob.arrayBuffer()) as Parameters<
        ExcelJsWorkbook['xlsx']['load']
      >[0];
      await workbook.xlsx.load(workbookBuffer);

      const visibleSheets = workbook.worksheets.filter(
        (worksheet) => worksheet.state === 'visible',
      );
      const worksheets = visibleSheets.length > 0 ? visibleSheets : workbook.worksheets;
      const sheets = worksheets.map((worksheet) => this.renderWorksheetPreview(worksheet, options));
      const totalSheets = worksheets.length;
      if (sheets.length === 0) {
        throw new Error('Workbook did not contain previewable sheets.');
      }

      return {
        mode: 'workbook',
        category: 'xlsx',
        summary: `${totalSheets} ${totalSheets === 1 ? 'sheet' : 'sheets'} preview`,
        sheets,
        activeSheetIndex: this.resolveActiveSheetIndex(workbook, worksheets),
      };
    } catch {
      return {
        mode: 'fallback',
        category: 'xlsx',
        message: 'Spreadsheet preview could not be generated in the browser.',
      };
    }
  }

  private renderWorksheetPreview(
    worksheet: ExcelJsWorksheet,
    options: AttachmentPreviewOptions,
  ): WorkbookPreviewSheet {
    const dimensions =
      worksheet.rowCount > 0 && worksheet.columnCount > 0 ? worksheet.dimensions : undefined;
    const rowStart = dimensions?.top ?? 1;
    const rowEnd = dimensions?.bottom ?? 1;
    const columnStart = dimensions?.left ?? 1;
    const columnEnd = dimensions?.right ?? 1;
    const rowLimit = options.compact ? COMPACT_PREVIEW_MAX_ROWS : FULL_PREVIEW_MAX_ROWS;
    const columnLimit = options.compact ? COMPACT_PREVIEW_MAX_COLUMNS : FULL_PREVIEW_MAX_COLUMNS;
    const rowIndexes = this.collectVisibleIndexes(
      rowStart,
      rowEnd,
      rowLimit,
      (index) => worksheet.getRow(index).hidden,
    );
    const columnIndexes = this.collectVisibleIndexes(
      columnStart,
      columnEnd,
      columnLimit,
      (index) => worksheet.getColumn(index).hidden,
    );

    const rows = rowIndexes.values.length > 0 ? rowIndexes.values : [1];
    const columns = columnIndexes.values.length > 0 ? columnIndexes.values : [1];
    const mergePreviewMap = this.buildMergePreviewMap(worksheet, rows, columns);
    const columnHeaders = columns
      .map(
        (columnNumber) =>
          `<th class="raz-sheet-column-header">${this.escapeHtml(this.columnLabel(columnNumber))}</th>`,
      )
      .join('');
    const colGroup = columns
      .map((columnNumber) => {
        const width = this.columnWidthToPixels(worksheet.getColumn(columnNumber));
        return `<col style="width:${width}px" />`;
      })
      .join('');
    const bodyRows = rows
      .map((rowNumber) => {
        const row = worksheet.getRow(rowNumber);
        const rowHeight = row.height
          ? ` style="height:${this.rowHeightToPixels(row.height)}px"`
          : '';
        const cells = columns
          .map((columnNumber) =>
            this.renderWorksheetCell(worksheet, row, rowNumber, columnNumber, mergePreviewMap),
          )
          .join('');
        return `<tr${rowHeight}><th class="raz-sheet-row-header">${rowNumber}</th>${cells}</tr>`;
      })
      .join('');
    const truncationDetails = [
      rowIndexes.truncated ? `${rows.length} of ${rowIndexes.total} rows` : `${rows.length} rows`,
      columnIndexes.truncated
        ? `${columns.length} of ${columnIndexes.total} columns`
        : `${columns.length} columns`,
    ];
    const freezeSummary = this.freezeSummary(worksheet.views[0]);
    const summary = `${truncationDetails.join(' · ')}${freezeSummary ? ` · ${freezeSummary}` : ''}`;
    const html = [
      '<style>',
      '.raz-sheet-preview{font-family:Calibri,Arial,sans-serif;color:#0f172a;}',
      '.raz-sheet-preview table{border-collapse:collapse;background:#fff;min-width:100%;}',
      '.raz-sheet-preview th,.raz-sheet-preview td{border:1px solid rgba(148,163,184,.45);}',
      '.raz-sheet-preview thead th{background:#f8fafc;font-size:11px;font-weight:600;padding:6px 8px;position:sticky;top:0;z-index:1;}',
      '.raz-sheet-preview tbody th{background:#f8fafc;font-size:11px;font-weight:600;padding:6px 8px;position:sticky;left:0;z-index:1;}',
      '.raz-sheet-preview td{font-size:12px;min-width:64px;padding:6px 8px;vertical-align:top;}',
      '.raz-sheet-preview a{color:#2563eb;text-decoration:underline;}',
      '</style>',
      '<div class="raz-sheet-preview">',
      '<table role="presentation">',
      `<colgroup><col style="width:48px" />${colGroup}</colgroup>`,
      `<thead><tr><th class="raz-sheet-corner"></th>${columnHeaders}</tr></thead>`,
      `<tbody>${bodyRows}</tbody>`,
      '</table>',
      '</div>',
    ].join('');

    return {
      id: `${worksheet.id}`,
      name: worksheet.name,
      html,
      summary,
    };
  }

  private renderWorksheetCell(
    worksheet: ExcelJsWorksheet,
    row: ExcelJsRow,
    rowNumber: number,
    columnNumber: number,
    mergePreviewMap: MergePreviewMap,
  ): string {
    const address = `${this.columnLabel(columnNumber)}${rowNumber}`;
    if (mergePreviewMap.hiddenAddresses.has(address)) {
      return '';
    }

    const cell = worksheet.getCell(rowNumber, columnNumber);
    const rowSpan = mergePreviewMap.spansByAddress.get(address)?.rowSpan ?? 1;
    const colSpan = mergePreviewMap.spansByAddress.get(address)?.colSpan ?? 1;
    const spanAttributes = [
      rowSpan > 1 ? ` rowspan="${rowSpan}"` : '',
      colSpan > 1 ? ` colspan="${colSpan}"` : '',
    ].join('');

    return `<td${spanAttributes} style="${this.buildCellStyle(cell, row, worksheet.getColumn(columnNumber))}">${this.cellContentHtml(cell)}</td>`;
  }

  private buildCellStyle(cell: ExcelJsCell, row: ExcelJsRow, column: ExcelJsColumn): string {
    const alignment = cell.alignment ?? row.alignment ?? column.alignment;
    const border = cell.border ?? row.border ?? column.border;
    const fill = cell.fill ?? row.fill ?? column.fill;
    const font = cell.font ?? row.font ?? column.font;
    const styles: string[] = [];
    const background = this.fillToCssColor(fill);
    if (background) {
      styles.push(`background:${background}`);
    }
    const textColor = this.colorToCss(font?.color);
    if (textColor) {
      styles.push(`color:${textColor}`);
    }
    if (font?.name) {
      styles.push(`font-family:${this.escapeCssValue(font.name)}`);
    }
    if (font?.size) {
      styles.push(`font-size:${this.pointsToPixels(font.size)}px`);
    }
    if (font?.bold) {
      styles.push('font-weight:700');
    }
    if (font?.italic) {
      styles.push('font-style:italic');
    }
    const textDecorations = [font?.underline ? 'underline' : '', font?.strike ? 'line-through' : '']
      .filter(Boolean)
      .join(' ');
    if (textDecorations) {
      styles.push(`text-decoration:${textDecorations}`);
    }
    if (alignment?.horizontal) {
      styles.push(
        `text-align:${alignment.horizontal === 'distributed' ? 'justify' : alignment.horizontal}`,
      );
    }
    if (alignment?.vertical) {
      styles.push(
        `vertical-align:${alignment.vertical === 'middle' ? 'middle' : alignment.vertical}`,
      );
    }
    if (alignment?.wrapText) {
      styles.push('white-space:pre-wrap');
    }
    if (alignment?.indent) {
      styles.push(`padding-left:${8 + alignment.indent * 10}px`);
    }
    if (border?.top) {
      styles.push(`border-top:${this.borderToCss(border.top.style, border.top.color)}`);
    }
    if (border?.right) {
      styles.push(`border-right:${this.borderToCss(border.right.style, border.right.color)}`);
    }
    if (border?.bottom) {
      styles.push(`border-bottom:${this.borderToCss(border.bottom.style, border.bottom.color)}`);
    }
    if (border?.left) {
      styles.push(`border-left:${this.borderToCss(border.left.style, border.left.color)}`);
    }
    return styles.join(';');
  }

  private cellContentHtml(cell: ExcelJsCell): string {
    const rawText = this.truncateText(this.cellDisplayText(cell));
    const displayText = rawText.length > 0 ? this.escapeHtml(rawText) : '&nbsp;';
    if (cell.hyperlink) {
      const href = this.escapeHtml(cell.hyperlink);
      return `<a href="${href}" rel="noreferrer noopener" target="_blank">${displayText}</a>`;
    }
    return displayText;
  }

  private cellDisplayText(cell: ExcelJsCell): string {
    if (cell.text) {
      return cell.text;
    }
    if (cell.result !== undefined && cell.result !== null) {
      return String(cell.result);
    }
    if (cell.formula) {
      return `=${cell.formula}`;
    }
    if (
      typeof cell.value === 'string' ||
      typeof cell.value === 'number' ||
      typeof cell.value === 'boolean'
    ) {
      return String(cell.value);
    }
    if (cell.value instanceof Date) {
      return cell.value.toLocaleString();
    }
    return '';
  }

  private buildMergePreviewMap(
    worksheet: ExcelJsWorksheet,
    rows: number[],
    columns: number[],
  ): MergePreviewMap {
    const hiddenAddresses = new Set<string>();
    const spansByAddress = new Map<string, { colSpan: number; rowSpan: number }>();
    const merges = worksheet.model?.merges ?? [];

    for (const mergeRange of merges) {
      const range = this.parseRange(mergeRange);
      if (!range) {
        continue;
      }
      const visibleRows = rows.filter(
        (rowNumber) => rowNumber >= range.top && rowNumber <= range.bottom,
      );
      const visibleColumns = columns.filter(
        (columnNumber) => columnNumber >= range.left && columnNumber <= range.right,
      );
      if (visibleRows.length === 0 || visibleColumns.length === 0) {
        continue;
      }

      const masterAddress = `${this.columnLabel(visibleColumns[0])}${visibleRows[0]}`;
      spansByAddress.set(masterAddress, {
        rowSpan: visibleRows.length,
        colSpan: visibleColumns.length,
      });
      for (const rowNumber of visibleRows) {
        for (const columnNumber of visibleColumns) {
          const address = `${this.columnLabel(columnNumber)}${rowNumber}`;
          if (address !== masterAddress) {
            hiddenAddresses.add(address);
          }
        }
      }
    }

    return { hiddenAddresses, spansByAddress };
  }

  private resolveActiveSheetIndex(
    workbook: ExcelJsWorkbook,
    worksheets: ExcelJsWorksheet[],
  ): number {
    const requestedSheet = workbook.views[0]?.activeTab;
    const targetSheet =
      requestedSheet === undefined ? undefined : workbook.worksheets[requestedSheet];
    if (!targetSheet) {
      return 0;
    }
    const matchingIndex = worksheets.findIndex((worksheet) => worksheet.id === targetSheet.id);
    return matchingIndex >= 0 ? matchingIndex : 0;
  }

  private collectVisibleIndexes(
    start: number,
    end: number,
    limit: number,
    isHidden: (index: number) => boolean,
  ): { total: number; truncated: boolean; values: number[] } {
    const values: number[] = [];
    let total = 0;
    for (let index = start; index <= end; index += 1) {
      if (isHidden(index)) {
        continue;
      }
      total += 1;
      if (values.length < limit) {
        values.push(index);
      }
    }

    return {
      values,
      total,
      truncated: total > values.length,
    };
  }

  private freezeSummary(view: ExcelJsView | undefined): string {
    if (view?.state !== 'frozen') {
      return '';
    }

    const frozenParts: string[] = [];
    if (view.ySplit) {
      frozenParts.push(`${view.ySplit} frozen ${view.ySplit === 1 ? 'row' : 'rows'}`);
    }
    if (view.xSplit) {
      frozenParts.push(`${view.xSplit} frozen ${view.xSplit === 1 ? 'column' : 'columns'}`);
    }
    return frozenParts.join(' · ');
  }

  private fillToCssColor(fill: import('exceljs').Fill | undefined): string | null {
    if (!fill) {
      return null;
    }

    if (fill.type === 'pattern') {
      return this.colorToCss(fill.fgColor ?? fill.bgColor);
    }

    return this.colorToCss(fill.stops[0]?.color);
  }

  private colorToCss(color: Partial<import('exceljs').Color> | undefined): string | null {
    const argb = color?.argb;
    if (!argb || (argb.length !== 6 && argb.length !== 8)) {
      return null;
    }

    const normalized = argb.length === 6 ? `FF${argb}` : argb;
    const alpha = Number.parseInt(normalized.slice(0, 2), 16) / 255;
    const red = Number.parseInt(normalized.slice(2, 4), 16);
    const green = Number.parseInt(normalized.slice(4, 6), 16);
    const blue = Number.parseInt(normalized.slice(6, 8), 16);
    if (alpha >= 1) {
      return `rgb(${red} ${green} ${blue})`;
    }
    return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(2)})`;
  }

  private borderToCss(
    style: import('exceljs').BorderStyle | undefined,
    color: Partial<import('exceljs').Color> | undefined,
  ): string {
    const cssColor = this.colorToCss(color) ?? 'rgba(148, 163, 184, 0.6)';
    const cssStyle =
      style === 'double'
        ? '2px double'
        : style === 'medium' || style === 'mediumDashed' || style === 'mediumDashDot'
          ? '2px solid'
          : style === 'dotted' || style === 'hair'
            ? '1px dotted'
            : style && style.includes('dash')
              ? '1px dashed'
              : '1px solid';
    return `${cssStyle} ${cssColor}`;
  }

  private fileExtension(name: string): string {
    const parts = name.toLowerCase().split('.');
    return parts.length > 1 ? (parts.at(-1) ?? '') : '';
  }

  private columnLabel(columnNumber: number): string {
    let value = columnNumber;
    let label = '';
    while (value > 0) {
      const remainder = (value - 1) % 26;
      label = String.fromCharCode(65 + remainder) + label;
      value = Math.floor((value - 1) / 26);
    }
    return label || 'A';
  }

  private parseRange(
    range: string,
  ): { bottom: number; left: number; right: number; top: number } | null {
    const [start, end = start] = range.split(':');
    const startCell = this.parseCellAddress(start);
    const endCell = this.parseCellAddress(end);
    if (!startCell || !endCell) {
      return null;
    }
    return {
      top: Math.min(startCell.row, endCell.row),
      bottom: Math.max(startCell.row, endCell.row),
      left: Math.min(startCell.column, endCell.column),
      right: Math.max(startCell.column, endCell.column),
    };
  }

  private parseCellAddress(address: string): { column: number; row: number } | null {
    const normalized = address.replace(/\$/g, '');
    const match = /^([A-Z]+)(\d+)$/i.exec(normalized);
    if (!match) {
      return null;
    }

    return {
      column: match[1]
        .toUpperCase()
        .split('')
        .reduce((total, letter) => total * 26 + (letter.charCodeAt(0) - 64), 0),
      row: Number.parseInt(match[2], 10),
    };
  }

  private columnWidthToPixels(column: ExcelJsColumn): number {
    const width = column.width ?? 12;
    return Math.max(64, Math.round(width * 8 + 16));
  }

  private rowHeightToPixels(height: number): number {
    return Math.max(20, Math.round((height * 96) / 72));
  }

  private pointsToPixels(points: number): number {
    return Math.max(10, Math.round((points * 96) / 72));
  }

  private truncateText(text: string): string {
    return text.length > PREVIEW_CELL_MAX_TEXT_LENGTH
      ? `${text.slice(0, PREVIEW_CELL_MAX_TEXT_LENGTH - 1)}…`
      : text;
  }

  private escapeCssValue(value: string): string {
    return `"${value.replace(/"/g, '\\"')}"`;
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
}
