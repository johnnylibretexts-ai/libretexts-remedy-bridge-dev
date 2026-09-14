import {JSDOM,VirtualConsole} from 'jsdom';
/** Remove only a duplicate page-owned loader after comparing it with the actual platform loader. */
export function deduplicateMathJaxInitializer(source:string,readerHtml:string) {
  const authored=new JSDOM(source,{includeNodeLocations:true,virtualConsole:new VirtualConsole()}),reader=new JSDOM(readerHtml,{virtualConsole:new VirtualConsole()});
  const loader=(s:Element)=>s.textContent?.includes('function loadMathJaxScript') && s.textContent.includes('MathJax.startup.defaultPageReady()') && s.textContent.includes('https://cdn.jsdelivr.net/npm/mathjax@4/tex-mml-svg.js');
  const owned=[...authored.window.document.querySelectorAll('script:not([src])')].filter(loader);
  const platform=[...reader.window.document.querySelectorAll('script:not([src])')].filter(loader);
  if(owned.length!==1 || platform.length!==2) return {changed:false,html:source,reason:'Expected one authored initializer and exactly two on the rendered page.'};
  const normalize=(value:string)=>value.replace(/\/\*<!\[CDATA\[\*\//g,'').replace(/\/\*\]\]>\*\//g,'')
    .replace(/\/\/<!-- (?:End )?MathJax Config -->/g,'').split('\n').map(line=>line.trim()).filter(line=>line && line!=='//')
    // The copied content's 0.85 scale is already expressed in its retained MathJax CSS/output.
    .map(line=>/^scale: (?:0\.85|1),$/.test(line)?'scale: PLATFORM,':line).join('\n');
  if(platform.some(s=>normalize(owned[0].textContent || '')!==normalize(s.textContent || ''))) return {changed:false,html:source,reason:'Custom MathJax configuration differs from the platform; manual review required.'};
  const location=authored.nodeLocation(owned[0]);
  if(!location) return {changed:false,html:source,reason:'No exact source range.'};
  return {changed:true,html:source.slice(0,location.startOffset)+source.slice(location.endOffset),reason:'Use the existing platform initializer; preserve all mathematical content and CSS.'};
}
