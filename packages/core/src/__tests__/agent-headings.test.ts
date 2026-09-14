import { expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { scanHtmlFull } from '../scan.js';
import { runAgentLoop } from '../agent-loop.js';
import { LLMClient } from '../ai/llm-client.js';

it('targets nested skipped headings accurately and preserves their content and attributes', async () => {
  const html = '<h2>Topic</h2><section><p>Context</p><h5 id="detail" class="keep"><em>Detail</em></h5></section>';
  const findings = await scanHtmlFull(html, { axe: false });
  const finding = findings.find(f => f.ruleId === 'heading-order')!;
  expect(new JSDOM(html).window.document.querySelector(finding.selector!)?.id).toBe('detail');
  const client = new LLMClient();
  vi.spyOn(client, 'chatTools').mockResolvedValue({content: JSON.stringify({tool:'set_heading_level', args:{selector:finding.selector,level:3}})});
  const result = await runAgentLoop({client,html,findings,maxIterations:1});
  expect(result.finalHtml).toContain('<h3 id="detail" class="keep"><em>Detail</em></h3>');
  expect((await scanHtmlFull(result.finalHtml, {axe:false})).filter(f=>f.ruleId==='heading-order')).toHaveLength(0);
});
it.each([{selector:'h4',level:2},{selector:'p',level:2},{selector:'#one',level:7}])('refuses ambiguous, non-heading and invalid level edits: %j', async args => {
  const html='<h2>Topic</h2><h4 id="one">One</h4><h4>Two</h4><p>Keep</p>';
  const client = new LLMClient();
  vi.spyOn(client,'chatTools').mockResolvedValue({content:JSON.stringify({tool:'set_heading_level',args})});
  const result=await runAgentLoop({client,html,findings:await scanHtmlFull(html,{axe:false}),maxIterations:1});
  expect(result.finalHtml).toBe(html);
});
