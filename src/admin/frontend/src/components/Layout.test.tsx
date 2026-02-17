import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Layout from './Layout';

describe('Layout', () => {
  it('should render header with title', () => {
    render(
      <Layout activeTab="overview" onTabChange={() => {}}>
        <div>Content</div>
      </Layout>
    );

    expect(screen.getByText('NextHello Admin')).toBeInTheDocument();
  });

  it('should render children content', () => {
    render(
      <Layout activeTab="overview" onTabChange={() => {}}>
        <div data-testid="test-content">Test Content</div>
      </Layout>
    );

    expect(screen.getByTestId('test-content')).toBeInTheDocument();
  });

  it('should render tab buttons', () => {
    render(
      <Layout activeTab="overview" onTabChange={() => {}}>
        <div>Content</div>
      </Layout>
    );

    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Swarm')).toBeInTheDocument();
  });

  it('should call onTabChange when tab clicked', () => {
    const onTabChange = vi.fn();

    render(
      <Layout activeTab="overview" onTabChange={onTabChange}>
        <div>Content</div>
      </Layout>
    );

    fireEvent.click(screen.getByText('Swarm'));

    expect(onTabChange).toHaveBeenCalledWith('swarm');
  });

  it('should show countdown timer initially', () => {
    render(
      <Layout activeTab="overview" onTabChange={() => {}}>
        <div>Content</div>
      </Layout>
    );

    expect(screen.getByText(/Auto-refresh in/)).toBeInTheDocument();
    expect(screen.getByText(/30/)).toBeInTheDocument();
  });

  it('should render refresh button', () => {
    render(
      <Layout activeTab="overview" onTabChange={() => {}}>
        <div>Content</div>
      </Layout>
    );

    expect(screen.getByText('Refresh')).toBeInTheDocument();
  });

  it('should render footer', () => {
    render(
      <Layout activeTab="overview" onTabChange={() => {}}>
        <div>Content</div>
      </Layout>
    );

    expect(screen.getByText('NextHello Admin Dashboard')).toBeInTheDocument();
  });
});
