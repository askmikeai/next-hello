import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Badge, {
  QualificationBadge,
  StatusBadge,
  ActivityStatusBadge,
  DirectionBadge,
} from './Badge';

describe('Badge', () => {
  it('should render children', () => {
    render(<Badge>Test</Badge>);
    expect(screen.getByText('Test')).toBeInTheDocument();
  });

  it('should apply default status variant', () => {
    render(<Badge>Default</Badge>);
    expect(screen.getByText('Default')).toHaveClass('badge-status');
  });

  it('should apply hot variant', () => {
    render(<Badge variant="hot">Hot</Badge>);
    expect(screen.getByText('Hot')).toHaveClass('badge-hot');
  });

  it('should apply warm variant', () => {
    render(<Badge variant="warm">Warm</Badge>);
    expect(screen.getByText('Warm')).toHaveClass('badge-warm');
  });

  it('should apply cold variant', () => {
    render(<Badge variant="cold">Cold</Badge>);
    expect(screen.getByText('Cold')).toHaveClass('badge-cold');
  });

  it('should apply success variant', () => {
    render(<Badge variant="success">Success</Badge>);
    expect(screen.getByText('Success')).toHaveClass('badge-success');
  });

  it('should apply fail variant', () => {
    render(<Badge variant="fail">Fail</Badge>);
    expect(screen.getByText('Fail')).toHaveClass('badge-fail');
  });

  it('should apply in variant', () => {
    render(<Badge variant="in">IN</Badge>);
    expect(screen.getByText('IN')).toHaveClass('badge-in');
  });

  it('should apply out variant', () => {
    render(<Badge variant="out">OUT</Badge>);
    expect(screen.getByText('OUT')).toHaveClass('badge-out');
  });
});

describe('QualificationBadge', () => {
  it('should render hot tier', () => {
    render(<QualificationBadge tier="hot" />);
    expect(screen.getByText('hot')).toHaveClass('badge-hot');
  });

  it('should render warm tier', () => {
    render(<QualificationBadge tier="warm" />);
    expect(screen.getByText('warm')).toHaveClass('badge-warm');
  });

  it('should render cold tier', () => {
    render(<QualificationBadge tier="cold" />);
    expect(screen.getByText('cold')).toHaveClass('badge-cold');
  });

  it('should render dash for null tier', () => {
    render(<QualificationBadge tier={null} />);
    expect(screen.getByText('-')).toBeInTheDocument();
  });
});

describe('StatusBadge', () => {
  it('should render status', () => {
    render(<StatusBadge status="qualified" />);
    expect(screen.getByText('qualified')).toHaveClass('badge-status');
  });

  it('should render dash for null status', () => {
    render(<StatusBadge status={null} />);
    expect(screen.getByText('-')).toBeInTheDocument();
  });
});

describe('ActivityStatusBadge', () => {
  it('should render OK for completed status', () => {
    render(<ActivityStatusBadge status="completed" />);
    expect(screen.getByText('OK')).toHaveClass('badge-success');
  });

  it('should render FAIL for failed status', () => {
    render(<ActivityStatusBadge status="failed" />);
    expect(screen.getByText('FAIL')).toHaveClass('badge-fail');
  });

  it('should render ... for other statuses', () => {
    render(<ActivityStatusBadge status="started" />);
    expect(screen.getByText('...')).toHaveClass('badge-status');
  });
});

describe('DirectionBadge', () => {
  it('should render IN for inbound', () => {
    render(<DirectionBadge direction="inbound" />);
    expect(screen.getByText('IN')).toHaveClass('badge-in');
  });

  it('should render OUT for outbound', () => {
    render(<DirectionBadge direction="outbound" />);
    expect(screen.getByText('OUT')).toHaveClass('badge-out');
  });
});
