// scroll-area — the viewport must not let its content set its own width.
//
// Radix renders the ScrollArea viewport's single child as
// `display: table; min-width: 100%`, which is shrink-to-fit: the box adopts its
// content's MAX-CONTENT width rather than the viewport's. Inside SidePanel —
// a 420px shell with `overflow-hidden` and no horizontal scrollbar — a long
// line therefore widens the whole column and the excess is CLIPPED with no way
// to scroll to it.
//
// That is the defect Chase reported on 2026-09-22: "the intelligence tab gets
// cut off to the right hand side and isn't completely viewable." Measured in
// Chromium at 1440x900 against the Intelligence panel's real rendered markup:
// 160 elements painted past the panel's right edge, the content column by 95px,
// with metric VALUES (16,771 packets, the model name, the arming chip) entirely
// off-screen. With the viewport child forced to `block`: 0.
//
// This test is the cheap guard on the class surviving. It cannot measure layout
// — jsdom has none — so it asserts the contract, and the measurement lives in
// the commit that introduced it.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ScrollArea } from './scroll-area';

describe('ScrollArea viewport', () => {
  it('forces the Radix viewport child to block so content cannot widen the column', () => {
    const { container } = render(
      <ScrollArea className="h-40">
        <div>content</div>
      </ScrollArea>,
    );
    const viewport = container.querySelector('[data-radix-scroll-area-viewport]');
    expect(viewport).not.toBeNull();
    expect(viewport!.className).toContain('[&>div]:!block');
    expect(viewport!.className).toContain('[&>div]:!min-w-0');
  });

  it('still renders its children', () => {
    const { getByText } = render(
      <ScrollArea>
        <span>a decision row</span>
      </ScrollArea>,
    );
    expect(getByText('a decision row')).toBeTruthy();
  });
});
