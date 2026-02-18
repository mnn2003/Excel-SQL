import { useState, useCallback } from 'react';
import { Database, Zap } from 'lucide-react';
import FileUploadZone from '@/components/FileUploadZone';
import DataPreviewTable from '@/components/DataPreviewTable';
import SqlOutputPanel from '@/components/SqlOutputPanel';
import ColumnSelector from '@/components/ColumnSelector';
import { parseExcelFile, type ParsedData } from '@/lib/excel-parser';
import { generateSQL } from '@/lib/sql-generator';
import { Switch } from '@/components/ui/switch';

const Index = () => {
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  const [tableName, setTableName] = useState('');
  const [sql, setSql] = useState('');
  const [error, setError] = useState('');
  const [parsing, setParsing] = useState(false);
  const [selectedColumns, setSelectedColumns] = useState<boolean[]>([]);
  const [includeCreateTable, setIncludeCreateTable] = useState(false);

  const handleFileSelect = useCallback(async (f: File) => {
    setFile(f);
    setError('');
    setSql('');
    setParsing(true);
    try {
      const data = await parseExcelFile(f);
      setParsedData(data);
      setSelectedColumns(new Array(data.headers.length).fill(true));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file.');
      setParsedData(null);
    } finally {
      setParsing(false);
    }
  }, []);

  const handleClear = useCallback(() => {
    setFile(null);
    setParsedData(null);
    setSql('');
    setError('');
    setTableName('');
    setSelectedColumns([]);
    setIncludeCreateTable(false);
  }, []);

  const handleToggleColumn = useCallback((index: number) => {
    setSelectedColumns((prev) => prev.map((v, i) => (i === index ? !v : v)));
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedColumns((prev) => prev.map(() => true));
  }, []);

  const handleDeselectAll = useCallback(() => {
    setSelectedColumns((prev) => prev.map(() => false));
  }, []);

  const handleConvert = useCallback(() => {
    if (!parsedData) return;
    const result = generateSQL({
      tableName,
      headers: parsedData.headers,
      rows: parsedData.rows,
      selectedColumns,
      includeCreateTable,
    });
    setSql(result);
  }, [parsedData, tableName, selectedColumns, includeCreateTable]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-5 sm:px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <Database className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">Excel → SQL</h1>
            <p className="text-xs text-muted-foreground">
              Convert spreadsheets to INSERT statements
            </p>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <FileUploadZone
          onFileSelect={handleFileSelect}
          currentFile={file}
          onClear={handleClear}
        />

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {parsing && (
          <p className="text-center text-sm text-muted-foreground animate-pulse">
            Parsing file…
          </p>
        )}

        {parsedData && (
          <>
            <DataPreviewTable data={parsedData} />

            {/* Column selector */}
            <ColumnSelector
              headers={parsedData.headers}
              selected={selectedColumns}
              onToggle={handleToggleColumn}
              onSelectAll={handleSelectAll}
              onDeselectAll={handleDeselectAll}
            />

            {/* Table name + options + convert */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <label
                  htmlFor="table-name"
                  className="text-sm font-medium text-foreground"
                >
                  Table Name
                </label>
                <input
                  id="table-name"
                  type="text"
                  value={tableName}
                  onChange={(e) => setTableName(e.target.value)}
                  placeholder="e.g. students"
                  className="w-full rounded-lg border border-input bg-card px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <label className="flex items-center gap-2 pb-1">
                <Switch
                  checked={includeCreateTable}
                  onCheckedChange={setIncludeCreateTable}
                />
                <span className="text-sm text-foreground whitespace-nowrap">
                  CREATE TABLE
                </span>
              </label>
              <button
                onClick={handleConvert}
                disabled={!parsedData || selectedColumns.every((s) => !s)}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                <Zap className="h-4 w-4" />
                Generate SQL
              </button>
            </div>
          </>
        )}

        {sql && <SqlOutputPanel sql={sql} tableName={tableName} />}
      </main>
    </div>
  );
};

export default Index;
