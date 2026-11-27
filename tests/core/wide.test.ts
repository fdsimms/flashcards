import { describe, expect, it } from 'vitest';
import { columnInsets, READABLE_WIDTH, SIDE_PANEL_WIDTH, sidePanelFits } from '../../src/core/wide';

describe('a wide window', () => {
  it('has room for a side panel only past the column, the panel and a gutter each side', () => {
    // An iPhone, an iPad in portrait (11 and 13 inch), then in landscape.
    expect(sidePanelFits(430)).toBe(false);
    expect(sidePanelFits(834)).toBe(false);
    expect(sidePanelFits(999)).toBe(false);
    expect(sidePanelFits(1000)).toBe(true);
    expect(sidePanelFits(1194)).toBe(true);
    expect(READABLE_WIDTH + SIDE_PANEL_WIDTH).toBe(960);
  });

  it('keeps a popup at the margin on a narrow window', () => {
    expect(columnInsets(390, 16)).toEqual({ left: 16, right: 16 });
    expect(columnInsets(660, 16)).toEqual({ left: 16, right: 16 });
  });

  it('lines a popup up with the centered column on a wide window', () => {
    const { left, right } = columnInsets(1194, 16);
    expect(left).toBe(277);
    expect(1194 - left - right).toBe(READABLE_WIDTH);
  });

  it('lines it up with the column as it sits beside a panel', () => {
    const { left, right } = columnInsets(1194, 16, SIDE_PANEL_WIDTH);
    expect(left).toBe(117);
    expect(right).toBe(117 + SIDE_PANEL_WIDTH);
    expect(1194 - left - right).toBe(READABLE_WIDTH);
  });
});
