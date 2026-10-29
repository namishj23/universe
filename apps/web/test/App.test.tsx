import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { App } from '../src/App';

it('renders the placeholder line', () => {
  render(<App />);
  expect(
    screen.getByText('UniVerse API is running. The interface is being built.'),
  ).toBeInTheDocument();
});
