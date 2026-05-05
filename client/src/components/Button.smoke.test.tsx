import { describe, it, expect } from 'vitest';
import { Button } from './ui/Button';

describe('Button smoke', () => {
  it('is defined', () => {
    expect(Button).toBeTypeOf('function');
  });
});
