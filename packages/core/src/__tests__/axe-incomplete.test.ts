import { expect, it } from 'vitest';
import { mapAxeFinding } from '../scan-axe.js';
it('keeps incomplete serious/critical checks informational instead of claiming confirmed failures', () => {
  const violation = {id:'aria-valid-attr',help:'Check ARIA',impact:'critical' as const,tags:['wcag412'],nodes:[]};
  const node = {target:['html'],html:'<html lang="en">',failureSummary:'Axe encountered an error; test manually'};
  expect(mapAxeFinding(violation,node,'info').severity).toBe('info');
  expect(mapAxeFinding(violation,node,'error').severity).toBe('error');
});
