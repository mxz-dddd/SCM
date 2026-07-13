import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders the scaffold workspace and shared correlation contract', () => {
    render(<App />);

    expect(screen.getByText('供应链协同工作台')).toBeInTheDocument();
    expect(screen.getByText(/X-Correlation-Id/)).toBeInTheDocument();
    expect(
      screen.getByText(/decimal amount and ISO currency/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '租户与认证' }),
    ).toBeInTheDocument();
    expect(screen.getByText('PROVISIONING')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /登\s*录/ })).toBeInTheDocument();
  });
});
