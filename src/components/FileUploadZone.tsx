import { useCallback, useState, useRef } from 'react';
import { Upload, FileSpreadsheet, X } from 'lucide-react';

interface FileUploadZoneProps {
  onFileSelect: (file: File) => void;
  currentFile: File | null;
  onClear: () => void;
}

/** Drag-and-drop file upload zone with click-to-browse fallback */
const FileUploadZone = ({ onFileSelect, currentFile, onClear }: FileUploadZoneProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragIn = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragOut = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const validateAndSelect = useCallback(
    (file: File) => {
      const validTypes = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv',
        'application/vnd.ms-excel',
      ];
      const validExts = ['.xlsx', '.csv', '.xls'];
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();

      if (!validTypes.includes(file.type) && !validExts.includes(ext)) {
        alert('Invalid file format. Please upload a .xlsx or .csv file.');
        return;
      }
      onFileSelect(file);
    },
    [onFileSelect]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) validateAndSelect(file);
    },
    [validateAndSelect]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) validateAndSelect(file);
    },
    [validateAndSelect]
  );

  if (currentFile) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-dropzone-bg p-4">
        <FileSpreadsheet className="h-8 w-8 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground">{currentFile.name}</p>
          <p className="text-sm text-muted-foreground">
            {(currentFile.size / 1024).toFixed(1)} KB
          </p>
        </div>
        <button
          onClick={onClear}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label="Remove file"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      onDragEnter={handleDragIn}
      onDragLeave={handleDragOut}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8 transition-all ${
        isDragging
          ? 'animate-pulse-border border-dropzone bg-dropzone-bg'
          : 'border-border hover:border-primary/50 hover:bg-muted/50'
      }`}
    >
      <Upload className={`h-10 w-10 ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
      <div className="text-center">
        <p className="font-medium text-foreground">
          Drop your Excel file here
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          or click to browse — .xlsx and .csv supported
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.csv,.xls"
        onChange={handleChange}
        className="hidden"
      />
    </div>
  );
};

export default FileUploadZone;
