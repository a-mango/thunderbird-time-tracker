import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/lib/errors.js';
import { parseDayTotal, parseEstimate, parseRate } from '../../src/lib/parse.js';

describe('parseEstimate', () => {
  it.each([
    ['90m', 90],
    ['90 m', 90],
    ['1.5h', 90],
    ['1,5h', 90],
    ['1,5 h', 90],
    ['1h30', 90],
    ['1h 30m', 90],
    ['1H30M', 90],
    ['1:30', 90],
    ['2h', 120],
    ['2', 120],
    ['0.5', 30],
    ['9.5', 570],
    ['10', 10],
    ['90', 90],
    ['  45m ', 45],
    ['0.33h', 20],
  ])('reads %j as %i minutes', (text, minutes) => {
    expect(parseEstimate(text)).toBe(minutes);
  });

  it('treats blank as no estimate', () => {
    expect(parseEstimate('')).toBeNull();
    expect(parseEstimate('   ')).toBeNull();
  });

  it.each(['abc', 'h', 'm', '1:75', '-1h', '1h-30', '0', '0m', '1e9', '99999999h', '1.5.2h'])(
    'refuses %j',
    (text) => {
      expect(() => parseEstimate(text)).toThrow(ValidationError);
    },
  );
});

describe('parseDayTotal', () => {
  it.each([
    ['1:30', 90],
    ['1.5h', 90],
    ['90m', 90],
    ['90', 90],
    ['2', 120],
    ['24h', 1440],
    ['', 0],
    ['  ', 0],
    ['0', 0],
    ['0m', 0],
    ['0h', 0],
    ['0:00', 0],
    ['0,0', 0],
  ])('reads %j as %i minutes', (text, minutes) => {
    expect(parseDayTotal(text)).toBe(minutes);
  });

  it.each(['abc', '25h', '1441m', '-1h', '1:75'])('refuses %j', (text) => {
    expect(() => parseDayTotal(text)).toThrow(expect.objectContaining({ code: 'duration' }));
  });
});

describe('parseRate', () => {
  it.each([
    ['95', 95],
    ['120.50', 120.5],
    ['120,5', 120.5],
    [' 1 250 ', 1250],
    ["1'250.75", 1250.75],
    ['0', 0],
    ['', null],
  ])('reads %j as %j', (text, rate) => {
    expect(parseRate(text)).toBe(rate);
  });

  it.each(['abc', '-5', '1.234', '1e3', '2000000', '12.'])('refuses %j', (text) => {
    expect(() => parseRate(text)).toThrow(expect.objectContaining({ code: 'hourlyRate' }));
  });
});
