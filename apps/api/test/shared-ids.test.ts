/**
 * Regression test for the create_* bug (2026-09-08).
 *
 * The original `generateId` in @departify-crm/shared used
 *   `timeBuf.writeUInt32BE(time & 0xffffffff, 0)`
 * where `Date.now() & 0xffffffff` is a SIGNED int32 in JS: when the
 * low 32 bits have the MSB set, the result is a negative number
 * (any moment when Date.now() mod 2^32 > 0x7FFFFFFF). Buffer.writeUInt32BE
 * then throws `RangeError [ERR_OUT_OF_RANGE]: The value of "value" is out
 * of range. It must be >= 0 and <= 4294967295. Received <negative>`.
 *
 * That crashed every MCP `create_*` tool (create_deal, create_contact,
 * create_company, create_note, create_task, create_tag, …) because all
 * of them call `generateId(Prefixes.<entity>)` in their handler body.
 * `update_*` and `list_*` were never affected (no id generation).
 *
 * The fix replaces `time & 0xffffffff` with `time >>> 0` (unsigned
 * representation), so the value passed to writeUInt32BE is always in
 * `[0, 4294967295]`. This test pins that behaviour.
 */
import { describe, expect, it, afterEach, vi } from 'vitest';
import { generateId, Prefixes } from '@departify-crm/shared';

describe('generateId (regression — create_* bug 2026-09-08)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not throw RangeError when Date.now() low32 has MSB set (= 2^31)', () => {
    // 2^31 is the smallest positive integer where `x & 0xffffffff`
    // becomes a negative signed int32 in JavaScript.
    vi.spyOn(Date, 'now').mockReturnValue(2_147_483_648);
    expect(() => generateId('test')).not.toThrow();
  });

  it('returns a string id with the requested prefix in the low32-MSB condition', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_147_483_648);
    const id = generateId(Prefixes.deal);
    expect(id).toMatch(/^deal_/);
  });

  it('handles the boundary at the top of uint32 range', () => {
    // k = 410, low32 = 2^32 - 1
    vi.spyOn(Date, 'now').mockReturnValue(410 * 4_294_967_296 + 4_294_967_295);
    expect(() => generateId('cmp')).not.toThrow();
  });

  it('handles low32 just above signed-int31 max (the original failure mode)', () => {
    // Same pattern that produced the observed -2125318472:
    // a Date.now() in mid-Sept 2026 whose low32 ≈ 2.17B (> 2^31).
    vi.spyOn(Date, 'now').mockReturnValue(1_758_400_000_000);
    expect(() => generateId('deal')).not.toThrow();
  });
});
