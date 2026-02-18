import { Checkbox } from '@/components/ui/checkbox';

interface ColumnSelectorProps {
  headers: string[];
  selected: boolean[];
  onToggle: (index: number) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

/** Allows users to pick which columns to include in SQL output */
const ColumnSelector = ({
  headers,
  selected,
  onToggle,
  onSelectAll,
  onDeselectAll,
}: ColumnSelectorProps) => {
  const allSelected = selected.every(Boolean);
  const noneSelected = selected.every((s) => !s);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Columns</h3>
        <button
          onClick={allSelected ? onDeselectAll : onSelectAll}
          className="text-xs font-medium text-primary hover:underline"
        >
          {allSelected ? 'Deselect all' : 'Select all'}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {headers.map((header, i) => (
          <label
            key={i}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              selected[i]
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : 'border-border bg-card text-muted-foreground'
            }`}
          >
            <Checkbox
              checked={selected[i]}
              onCheckedChange={() => onToggle(i)}
              className="h-3.5 w-3.5"
            />
            <span className="font-mono">{header}</span>
          </label>
        ))}
      </div>
      {noneSelected && (
        <p className="text-xs text-destructive">Select at least one column</p>
      )}
    </div>
  );
};

export default ColumnSelector;
