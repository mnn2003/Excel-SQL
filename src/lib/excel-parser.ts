import * as XLSX from 'xlsx';

/** Represents a parsed Excel file with headers and row data */
export interface ParsedData {
  headers: string[];
  rows: (string | number | null | Date)[][];
}

/**
 * Parse an uploaded Excel or CSV file into headers + rows.
 * The first row is treated as column headers.
 */
export function parseExcelFile(file: File): Promise<ParsedData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });

        // Use the first sheet
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
          reject(new Error('No sheets found in the file.'));
          return;
        }

        const sheet = workbook.Sheets[sheetName];
        // Parse as array of arrays with raw values
        const rawData: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: null,
          raw: false,
          dateNF: 'yyyy-mm-dd',
        });

        if (rawData.length < 2) {
          reject(new Error('File must have at least a header row and one data row.'));
          return;
        }

        // First row = headers
        const headers = (rawData[0] as unknown[]).map((h) =>
          h != null ? String(h).trim() : ''
        );

        // Remaining rows = data
        const rows = rawData.slice(1).filter((row) =>
          row.some((cell) => cell != null && String(cell).trim() !== '')
        ).map((row) =>
          headers.map((_, i) => {
            const cell = row[i];
            if (cell == null || String(cell).trim() === '') return null;
            // Try to detect numbers
            const str = String(cell).trim();
            if (/^-?\d+(\.\d+)?$/.test(str)) return Number(str);
            return str;
          })
        );

        resolve({ headers, rows });
      } catch {
        reject(new Error('Failed to parse file. Ensure it is a valid .xlsx or .csv file.'));
      }
    };

    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsArrayBuffer(file);
  });
}
