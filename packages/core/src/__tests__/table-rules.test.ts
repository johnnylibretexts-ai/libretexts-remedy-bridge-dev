import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { tableLabelRule } from '../rules/table-label.js';
import { tableStructureRule } from '../rules/table-structure.js';
import { scanHtml } from '../scan.js';

describe('table remediation rules', () => {
  it('links data cells to a header that spans multiple columns', async () => {
    const html = `
      <table>
        <thead>
          <tr>
            <th scope="col" id="prefix">Prefix</th>
            <th scope="col" id="factor" colspan="2">Multiplying factor</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td headers="prefix">kilo-</td>
            <td headers="factor">1000</td>
            <td></td>
          </tr>
        </tbody>
      </table>
    `;
    const finding = scanHtml(html, [tableStructureRule])[0]!;
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);

    const changed = await tableStructureRule.fix!(dom.window.document, finding, {
      page: { id: 1, path: '/', hostname: 'dev.libretexts.org' },
      env: process.env,
    });

    expect(changed).toBe(true);
    expect(dom.window.document.querySelector('tbody td:last-child')?.getAttribute('headers')).toBe('factor');
  });

  it('does not mark unlabeled tables fixable when no deterministic caption source exists', () => {
    const findings = scanHtml('<table><tr><td>No heading nearby</td></tr></table>', [tableLabelRule]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'table-label',
      fixable: false,
      data: {
        fixBlockedReason: 'missing-table-label-source',
      },
    });
  });

  it('marks unlabeled tables fixable when a preceding heading can supply the caption', () => {
    const findings = scanHtml('<h2>Metric prefixes</h2><table><tr><td>kilo</td></tr></table>', [tableLabelRule]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'table-label',
      fixable: true,
      data: {
        captionSource: 'preceding-heading',
      },
    });
  });
});

it('allocates header IDs across the whole document so multiple tables do not create duplicate IDs', async () => {
  const html='<p id="th-name">Keep anchor</p>'+Array(2).fill('<table><thead><tr><th scope="col">Name</th></tr></thead><tbody><tr><td>Oxygen</td></tr></tbody></table>').join('');
  const doc=new JSDOM(html).window.document;
  for(const finding of scanHtml(html,[tableStructureRule])) await tableStructureRule.fix!(doc,finding,{page:{id:1,path:'/',hostname:'dev.libretexts.org'},env:{}});
  const ids=Array.from(doc.querySelectorAll('[id]')).map(el=>el.id);
  expect(new Set(ids).size).toBe(ids.length);
  for(const td of doc.querySelectorAll('td')) expect(doc.getElementById(td.getAttribute('headers')!)?.closest('table')).toBe(td.closest('table'));
});

it('does not mislabel a first-row data record as column headers', async () => {
  const {tableHeaderRule}=await import('../rules/table-header.js');
  const html='<table><tr><td>6-mercaptopurine</td><td>Purinethol</td></tr><tr><td>Gemcitabine</td><td>Gemzar</td></tr></table>';
  const finding=scanHtml(html,[tableHeaderRule])[0];
  expect(finding.fixable).toBe(false);
  const doc=new JSDOM(html).window.document;
  expect(await tableHeaderRule.fix!(doc,finding,{page:{id:1,path:'/',hostname:'dev.libretexts.org'},env:{}})).toBe(false);
  expect(doc.body.innerHTML).toBe(new JSDOM(html).window.document.body.innerHTML);
});
it('associates grouped columns without treating a row-spanning column heading as a row header',async()=>{
 const html='<table><thead><tr><th scope="col" rowspan="2">Number</th><th scope="col" colspan="2">Shells</th></tr><tr><th scope="col">K</th><th scope="col">L</th></tr></thead><tbody><tr><td>1</td><td>2</td><td>3</td></tr></tbody></table>';
 const doc=new JSDOM(html).window.document;
 await tableStructureRule.fix!(doc,scanHtml(html,[tableStructureRule])[0],{page:{id:1,path:'/',hostname:'dev.libretexts.org'},env:{}});
 const cell=doc.querySelectorAll('td')[1];
 expect(cell.getAttribute('headers')!.split(' ').map(id=>doc.getElementById(id)!.textContent)).toEqual(['Shells','K']);
});
