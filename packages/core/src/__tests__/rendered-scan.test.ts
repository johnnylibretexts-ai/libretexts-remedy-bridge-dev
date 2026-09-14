import {it,expect} from 'vitest';
import {mergeRenderedFindings} from '../rendered-scan.js';
import {buildWcagReview} from '../wcag.js';
import type {Finding} from '../types.js';
const source:Finding[]=[{ruleId:'axe/aria-valid-attr',severity:'info',message:'Axe encountered an error; test the page manually',source:'cxone-health',fixable:false},{ruleId:'img-alt',severity:'error',message:'Missing alt',source:'remedy',fixable:true}];
it('retains source failures and only supersedes confirmed browser-covered execution errors',()=>{
 const r=mergeRenderedFindings(source,{state:'complete',passedRules:['aria-valid-attr']});
 expect(r.resolvedSourceChecks).toHaveLength(1);expect(r.findings).toEqual([source[1]]);
 expect(mergeRenderedFindings(source,{state:'incomplete',passedRules:['aria-valid-attr']}).resolvedSourceChecks).toHaveLength(0);
 expect(mergeRenderedFindings(source,{state:'error'}).findings).toEqual(source);
});
it('maps browser-only failures to WCAG without making them automatically writable',()=>{
 const r=mergeRenderedFindings([],{state:'complete',violations:[{id:'color-contrast',tags:['wcag143'],description:'Contrast',nodes:[{target:['.nav'],html:'<a>Home</a>'}]}]});
 expect(r.findings[0]).toMatchObject({wcag:'1.4.3',fixable:false,severity:'warning'});
 expect(buildWcagReview({html:'<p>x</p>',findings:r.findings}).criteria.find(c=>c.id==='1.4.3')?.status).toBe('fail');
});
it('old manual passes cannot mask a new scanner failure',()=>{
 const previous=buildWcagReview({html:'<p>x</p>',findings:[]});
 Object.assign(previous.criteria[0],{source:'manual',status:'pass'});
 expect(buildWcagReview({html:'<img>',findings:[source[1]],previousReview:previous}).criteria[0].status).toBe('fail');
});

it('records covered execution errors separately while incomplete reader readiness remains a blocker',()=>{
 const r=mergeRenderedFindings(source,{state:'incomplete',math:{ready:true},passedRules:['aria-valid-attr'],failedResources:['https://example.org/missing.js']});
 expect(r.resolvedSourceChecks).toEqual([source[0]]);
 expect(r.findings.some(f=>f.ruleId==='rendered/page-readiness' && f.severity==='info')).toBe(true);
 expect(r.findings).toContainEqual(source[1]);
});
