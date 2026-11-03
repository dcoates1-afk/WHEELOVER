import { describe, expect, it } from 'vitest';
import { eaNamesMatch, eaNormalize, isEaJoinableName } from './clearances';

describe('EA headway name matching', () => {
  it('keeps parentheticals as words', () => {
    expect(eaNormalize('Road Bridge (GT Barford)')).toBe('road gt barford');
    expect(eaNormalize("St John's Bridge")).toBe('st john');
  });

  it('strips stopwords and bridge suffixes', () => {
    expect(eaNormalize('Railway Bridge d\\s of Ely, Willow Walk')).toBe('railway ely willow walk');
    expect(eaNormalize('Upware Lock and Road Bridge, Reach Lode')).toBe(
      'upware lock road reach lode',
    );
  });

  it('refuses generic-only names', () => {
    expect(isEaJoinableName('Road Bridge')).toBe(false);
    expect(isEaJoinableName('Footbridge')).toBe(false);
    expect(isEaJoinableName('Railway Bridge')).toBe(false);
    expect(isEaJoinableName('Rail Bridge')).toBe(false);
    expect(isEaJoinableName('Cricklade Bridge')).toBe(true);
    expect(isEaJoinableName('Branch Bridge')).toBe(true);
    expect(isEaJoinableName('Potters Foot Bridge')).toBe(true);
    expect(isEaJoinableName('Road Bridge (GT Barford)')).toBe(true);
  });

  it('matches exact names and dual names on either side', () => {
    expect(eaNamesMatch('Cricklade Bridge', 'Cricklade Bridge')).toBe(true);
    expect(
      eaNamesMatch(
        'Charter Walk / St Mary’s Embankment Footbridge',
        'Charter Walk Footbridge',
      ),
    ).toBe(true);
    expect(
      eaNamesMatch(
        'Charter Walk / St Mary’s Embankment Footbridge',
        "St Mary's Embankment Footbridge",
      ),
    ).toBe(true);
    expect(eaNamesMatch('Railway Bridge, Prickwillow', 'Prickwillow Railway Bridge')).toBe(true);
  });

  it('never lets a qualified name land on the plain kind', () => {
    expect(eaNamesMatch('Railway Bridge d\\s of Ely, Willow Walk', 'Railway Bridge')).toBe(
      false,
    );
    expect(eaNamesMatch('Railway Bridge, Prickwillow', 'Railway Bridge')).toBe(false);
    expect(eaNamesMatch('Road Bridge (GT Barford)', 'Road Bridge')).toBe(false);
    expect(eaNamesMatch('Footbridge', 'Charter Walk Footbridge')).toBe(false);
  });

  it('falls back to a distinctive pre-comma part, never a generic one', () => {
    expect(eaNamesMatch('Halfpenny Bridge, Lechlade', 'Halfpenny Bridge')).toBe(true);
    expect(
      eaNamesMatch('Upware Lock and Road Bridge, Reach Lode', 'Upware Lock Road Bridge'),
    ).toBe(true);
    expect(eaNamesMatch('The Anchor Road bridge, Burwell', 'The Anchor Road Bridge')).toBe(
      true,
    );
  });
});
