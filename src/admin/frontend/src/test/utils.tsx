import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

interface WrapperProps {
  children: ReactNode;
}

function AllProviders({ children }: WrapperProps) {
  return <>{children}</>;
}

function customRender(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return render(ui, { wrapper: AllProviders, ...options });
}

export * from '@testing-library/react';
export { customRender as render };
