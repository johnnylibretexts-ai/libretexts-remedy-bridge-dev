import {it,expect} from 'vitest';
import {deduplicateMathJaxInitializer} from '../mathjax-initializer.js';
const script=`<script>function loadMathJaxScript() {const src='https://cdn.jsdelivr.net/npm/mathjax@4/tex-mml-svg.js';}
MathJax.startup.defaultPageReady();
scale: 0.85,
</script>`;
it('removes only a proven duplicate initializer while preserving math and surrounding bytes',()=>{
 const source='<p>Before</p><math><mfrac><mi>x</mi><mn>2</mn></mfrac></math>'+script+'<p>After</p>';
 const reader='<section class="mt-content-container">'+source+'</section>'+script.replace('0.85','1');
 const r=deduplicateMathJaxInitializer(source,reader);expect(r.changed).toBe(true);expect(r.html).toBe(source.replace(script,''));
});
it('keeps custom or ambiguous configurations and pages without a platform loader',()=>{
 expect(deduplicateMathJaxInitializer(script,'<section class="mt-content-container">'+script+'</section>').changed).toBe(false);
 expect(deduplicateMathJaxInitializer(script,script.replace('defaultPageReady();','defaultPageReady(); customMacro();')).changed).toBe(false);
 expect(deduplicateMathJaxInitializer(script,script+script+script).changed).toBe(false);
});
