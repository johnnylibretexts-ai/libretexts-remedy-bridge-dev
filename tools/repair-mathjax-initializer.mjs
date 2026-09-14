#!/usr/bin/env node
import 'dotenv/config';
import {createExpertClient,resolvePageRef,fetchPageHtml,hashContent,writePageRevision,deduplicateMathJaxInitializer} from '../packages/core/dist/index.js';
const apply=process.argv.includes('--apply'),urls=process.argv.slice(2).filter(s=>s!=='--apply');
if(!urls.length)throw Error('Usage: node tools/repair-mathjax-initializer.mjs <sandbox-page-url> [--apply]');
const expert=createExpertClient();
for(const url of urls){
 const page=await resolvePageRef(expert,url,process.env),before=await fetchPageHtml(expert,url);
 const response=await fetch(url,{signal:AbortSignal.timeout(45000)});
 if(!response.ok)throw Error(`Reader HTTP ${response.status}`);
 const proposal=deduplicateMathJaxInitializer(before,await response.text());
 const result={pageId:page.id,path:page.path,changed:proposal.changed,reason:proposal.reason,beforeHash:hashContent(before),afterHash:hashContent(proposal.html)};
 if(apply&&proposal.changed){
  if(hashContent(await fetchPageHtml(expert,url))!==result.beforeHash)throw Error('Source changed. Review again.');
  result.write=await writePageRevision({expert,pageInput:url,page,beforeHtml:before,afterHtml:proposal.html,rules:['mathjax-duplicate-initializer'],revisionSummary:'Remedy: remove duplicate page MathJax initializer; retain platform renderer and equation markup',source:'pipeline'});
  result.verified=hashContent(await fetchPageHtml(expert,url))===result.afterHash;
 }
 console.log(JSON.stringify(result));
}
