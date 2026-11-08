import { describe, expect, it } from 'vitest';
import { multiplyDecimalStrings } from './decimal-math';

describe('multiplyDecimalStrings', () => {
  it('é exato onde o ponto flutuante divergia em 0,0001', () => {
    expect(multiplyDecimalStrings('46.466473', '250.0000', 4)).toBe('11616.6183');
    expect(multiplyDecimalStrings('20.2075', '423.7', 4)).toBe('8561.9178');
    expect(multiplyDecimalStrings('11.9266', '274.25', 4)).toBe('3270.8701');
  });

  it('completa casas e mantém escala fixa', () => {
    expect(multiplyDecimalStrings('2', '3', 4)).toBe('6.0000');
    expect(multiplyDecimalStrings('0.1', '3', 4)).toBe('0.3000');
    expect(multiplyDecimalStrings('7', '0', 2)).toBe('0.00');
    expect(multiplyDecimalStrings('3', '4', 0)).toBe('12');
  });

  it('arredonda half-up (afastando do zero) exatamente no meio', () => {
    expect(multiplyDecimalStrings('1.00005', '1', 4)).toBe('1.0001');
    expect(multiplyDecimalStrings('1.00004', '1', 4)).toBe('1.0000');
    expect(multiplyDecimalStrings('-1.00005', '1', 4)).toBe('-1.0001');
  });

  it('trata sinais e zero negativo', () => {
    expect(multiplyDecimalStrings('-2.5', '4', 2)).toBe('-10.00');
    expect(multiplyDecimalStrings('-2', '-3', 2)).toBe('6.00');
    expect(multiplyDecimalStrings('-0.00001', '1', 4)).toBe('0.0000');
  });

  it('não perde precisão com valores grandes', () => {
    expect(multiplyDecimalStrings('9007199254740993', '1', 0)).toBe('9007199254740993');
  });

  it('devolve null para operando inválido', () => {
    for (const bad of ['', 'abc', '1e3', '1.', '.5', '1,5', 'NaN']) {
      expect(multiplyDecimalStrings(bad, '1', 4)).toBeNull();
      expect(multiplyDecimalStrings('1', bad, 4)).toBeNull();
    }
  });
});
