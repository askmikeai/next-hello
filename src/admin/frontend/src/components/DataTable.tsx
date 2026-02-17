import type { ReactNode } from 'react';

interface Column<T> {
  key: string;
  header: string;
  render: (item: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (item: T) => string;
  emptyMessage?: string;
}

export default function DataTable<T>({
  columns,
  data,
  keyExtractor,
  emptyMessage = 'No data',
}: DataTableProps<T>) {
  if (data.length === 0) {
    return (
      <table>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={columns.length} className="text-muted">
              {emptyMessage}
            </td>
          </tr>
        </tbody>
      </table>
    );
  }

  return (
    <table>
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key}>{col.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((item) => (
          <tr key={keyExtractor(item)}>
            {columns.map((col) => (
              <td key={col.key} className={col.className}>
                {col.render(item)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
