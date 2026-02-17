import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DataTable from './DataTable';

interface TestItem {
  id: string;
  name: string;
  value: number;
}

const columns = [
  { key: 'name', header: 'Name', render: (item: TestItem) => item.name },
  { key: 'value', header: 'Value', render: (item: TestItem) => item.value },
];

describe('DataTable', () => {
  it('should render headers', () => {
    const data: TestItem[] = [
      { id: '1', name: 'Item 1', value: 100 },
    ];

    render(
      <DataTable
        columns={columns}
        data={data}
        keyExtractor={(item) => item.id}
      />
    );

    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Value')).toBeInTheDocument();
  });

  it('should render data rows', () => {
    const data: TestItem[] = [
      { id: '1', name: 'Item 1', value: 100 },
      { id: '2', name: 'Item 2', value: 200 },
    ];

    render(
      <DataTable
        columns={columns}
        data={data}
        keyExtractor={(item) => item.id}
      />
    );

    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('Item 2')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
  });

  it('should show empty message when no data', () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        keyExtractor={(item) => item.id}
      />
    );

    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('should show custom empty message', () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        keyExtractor={(item) => item.id}
        emptyMessage="No items found"
      />
    );

    expect(screen.getByText('No items found')).toBeInTheDocument();
  });

  it('should apply column className', () => {
    const columnsWithClass = [
      { key: 'name', header: 'Name', render: (item: TestItem) => item.name, className: 'text-muted' },
    ];

    const data: TestItem[] = [{ id: '1', name: 'Test', value: 1 }];

    render(
      <DataTable
        columns={columnsWithClass}
        data={data}
        keyExtractor={(item) => item.id}
      />
    );

    expect(screen.getByText('Test').closest('td')).toHaveClass('text-muted');
  });
});
