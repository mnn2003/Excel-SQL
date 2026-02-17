import { useState } from 'react';
import { Copy, Check, Download } from 'lucide-react';

interface SqlOutputPanelProps {
  sql: string;
  tableName: string;
}

/** Displays generated SQL with copy and download actions */
const SqlOutputPanel = ({ sql, tableName }: SqlOutputPanelProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([sql], { type: 'text/sql' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tableName || 'output'}.sql`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Generated SQL
        </h3>
        <div className="flex gap-1.5">
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button
            onClick={handleDownload}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Download className="h-3.5 w-3.5" />
            Download .sql
          </button>
        </div>
      </div>
      <div className="max-h-80 overflow-auto rounded-lg bg-code p-4">
        <pre className="font-mono text-xs leading-relaxed text-code-foreground">
          {sql}
        </pre>
      </div>
    </div>
  );
};

export default SqlOutputPanel;
