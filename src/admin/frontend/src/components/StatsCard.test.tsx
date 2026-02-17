import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatsCard from './StatsCard';

describe('StatsCard', () => {
  it('should render value and label', () => {
    render(<StatsCard value={100} label="Contacts" />);

    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('Contacts')).toBeInTheDocument();
  });

  it('should render string value', () => {
    render(<StatsCard value="OK" label="Health" />);

    expect(screen.getByText('OK')).toBeInTheDocument();
  });

  it('should apply success variant', () => {
    render(<StatsCard value="OK" label="Health" variant="success" />);

    expect(screen.getByText('OK')).toHaveClass('health-ok');
  });

  it('should apply danger variant', () => {
    render(<StatsCard value="FAIL" label="Health" variant="danger" />);

    expect(screen.getByText('FAIL')).toHaveClass('health-fail');
  });

  it('should not apply variant class for default', () => {
    render(<StatsCard value={50} label="Queue Jobs" />);

    const valueElement = screen.getByText('50');
    expect(valueElement).not.toHaveClass('health-ok');
    expect(valueElement).not.toHaveClass('health-fail');
  });
});
