import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import App from '../src/App';

describe('smoke', () => {
  it('renders App without crashing', () => {
    render(createElement(App));
    expect(screen.getByRole('heading')).toBeTruthy();
  });
});
