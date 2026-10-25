// OWNER: karthik
import { describe, expect, it } from 'vitest';
import { visemeForChar, charIndexAt } from '../../../src/world/npc/visemes';
describe('visemes', () => {
  it.each([['ah','A'],['eiyéÉ','E'],['o','O'],['uwq','U'],['mbp','M'],['fv','F'],['lntdszckgjrx0123456789','C'],[' !.?🙂','Rest']])('maps %s', (chars, expected) => { for (const c of chars) expect(visemeForChar(c)).toBe(expected); });
  it('binary searches half-open intervals and gaps', () => {
    const a = { chars: ['a','b'], starts: [0.1,0.4], ends:[0.3,0.6] };
    for (const [t,k] of [[0,-1],[0.1,0],[0.29,0],[0.3,-1],[0.4,1],[0.6,-1],[Infinity,-1]]) expect(charIndexAt(a,t)).toBe(k);
  });
});
