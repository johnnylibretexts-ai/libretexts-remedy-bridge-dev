import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import axe from 'axe-core';
test('native browser evaluates MathML without jsdom execution errors and retains real ARIA failures',{skip:process.env.RUN_BROWSER_TESTS!=='1'},async()=>{
 const browser=await chromium.launch({chromiumSandbox:true});
 try{
  const page=await browser.newPage();
  for(const math of ['<math><mi>x</mi></math>','<math><mfrac><mi>x</mi><mn>2</mn></mfrac><mo>+</mo><msup><mi>y</mi><mn>3</mn></msup></math>','<span aria-hidden="true"><math><mi>x</mi></math></span>']){
   await page.setContent(`<!doctype html><html lang="en"><head><title>Math test</title></head><body><main><h1>Expression</h1>${math}<button aria-bogus="true">Real invalid ARIA</button></main></body></html>`);
   await page.addScriptTag({content:axe.source});
   const r=await page.evaluate(()=>window.axe.run(document,{runOnly:{type:'rule',values:['aria-allowed-attr','aria-valid-attr-value','aria-valid-attr','aria-hidden-focus']}}));
   assert.ok(r.violations.some(v=>v.id==='aria-valid-attr'));
   for(const v of r.incomplete)for(const n of v.nodes)assert.ok(![...n.any,...n.all,...n.none].some(c=>c.id==='error-occurred'));
  }
 }finally{await browser.close();}
});
