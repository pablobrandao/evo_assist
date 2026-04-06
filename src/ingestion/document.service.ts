import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { extractTextFromPDF } from './pdf.service';

export interface SupportedDocument {
  filename: string;
  mimetype: string;
  extension: string;
}

function normalizeExtension(filename: string): string {
  const match = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? `.${match[1]}` : '';
}

export function resolveSupportedDocument(
  filename: string,
  part?: { type?: string; subtype?: string; disposition?: string }
): SupportedDocument | null {
  const extension = normalizeExtension(filename);
  const contentType = `${part?.type ?? ''}/${part?.subtype ?? ''}`.toLowerCase();

  if (extension === '.pdf' || contentType === 'application/pdf') {
    return { filename, mimetype: 'application/pdf', extension };
  }

  if (
    extension === '.docx' ||
    contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return {
      filename,
      mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension,
    };
  }

  if (
    extension === '.xlsx' ||
    contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return {
      filename,
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension,
    };
  }

  if (extension === '.csv' || contentType === 'text/csv') {
    return { filename, mimetype: 'text/csv', extension };
  }

  if (extension === '.txt' || contentType === 'text/plain') {
    return { filename, mimetype: 'text/plain', extension };
  }

  return null;
}

export async function extractTextFromDocument(
  buffer: Buffer,
  document: SupportedDocument
): Promise<string> {
  switch (document.extension) {
    case '.pdf':
      return await extractTextFromPDF(buffer);
    case '.docx': {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }
    case '.xlsx': {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheets = workbook.SheetNames.map(name => {
        const sheet = workbook.Sheets[name];
        const text = XLSX.utils.sheet_to_csv(sheet);
        return `Planilha: ${name}\n${text}`;
      });
      return sheets.join('\n\n');
    }
    case '.csv':
    case '.txt':
      return buffer.toString('utf-8');
    default:
      throw new Error(`Formato nao suportado para extracao: ${document.extension}`);
  }
}
