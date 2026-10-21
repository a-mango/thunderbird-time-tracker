import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/lib/errors.js';
import { DEFAULT_SETTINGS, validateSettings } from '../../src/lib/settings.js';

describe('settings schema', () => {
  it('accepts the defaults and returns a fresh copy', () => {
    const clean = validateSettings(DEFAULT_SETTINGS);
    expect(clean).toEqual(DEFAULT_SETTINGS);
    expect(clean).not.toBe(DEFAULT_SETTINGS);
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
  });

  it('accepts a partial patch', () => {
    expect(validateSettings({ weekStart: 0, durationFormat: 'decimal' })).toEqual({
      weekStart: 0,
      durationFormat: 'decimal',
    });
    expect(validateSettings({})).toEqual({});
  });

  it.each([[null], [[]], ['weekStart'], [42], [undefined]])('rejects %j', (value) => {
    expect(() => validateSettings(value)).toThrow(ValidationError);
  });

  it('rejects an unknown key and names it', () => {
    let error;
    try {
      validateSettings({ theme: 'dark' });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.code).toBe('settings');
    expect(error.details.key).toBe('theme');
  });

  it.each([
    ['density', 'tiny'],
    ['accent', 'green'],
    ['accent', 3],
    ['weekStart', 2],
    ['weekStart', '1'],
    ['dailyTargetMin', -1],
    ['dailyTargetMin', 24 * 60 + 1],
    ['dailyTargetMin', 30.5],
    ['durationFormat', 'hours'],
    ['showDone', 'false'],
    ['confirmDelete', 1],
    ['idleThresholdMin', 0],
    ['idleThresholdMin', 241],
    ['roundingMin', 10],
  ])('rejects %s = %j', (key, value) => {
    expect(() => validateSettings({ [key]: value })).toThrow(
      expect.objectContaining({ code: 'settings', details: { key } }),
    );
  });

  it.each([
    ['density', 'compact'],
    ['accent', 'teal'],
    ['dailyTargetMin', 0],
    ['idleThresholdMin', 240],
    ['roundingMin', 15],
  ])('accepts %s = %j', (key, value) => {
    expect(validateSettings({ [key]: value })).toEqual({ [key]: value });
  });
});
