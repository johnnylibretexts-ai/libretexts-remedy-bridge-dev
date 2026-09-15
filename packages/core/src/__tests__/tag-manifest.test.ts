import { describe, expect, it } from 'vitest';
import { parseRenderedTags, sourcePathFor } from '../tag-manifest.js';

describe('sourcePathFor', () => {
  it('maps a Biology sandbox path onto the Kimball source book path', () => {
    expect(
      sourcePathFor('Sandboxes/johnnyphung/biology/01:_The_Chemical_Basis_of_Life/1.02:_Elements_and_Atoms'),
    ).toBe(
      'Bookshelves/Introductory_and_General_Biology/Biology_(Kimball)/01:_The_Chemical_Basis_of_Life/1.02:_Elements_and_Atoms',
    );
  });

  it('refuses a path outside the Biology sandbox', () => {
    expect(() => sourcePathFor('Sandboxes/johnnyphung/chemistry/1.01')).toThrow(/biology/);
  });
});

describe('parseRenderedTags', () => {
  it('reads the JSON tag list out of the rendered #pageTagsHolder div', () => {
    const html = `<div style="display:none" id="pageTagsHolder">[ &quot;article:topic&quot;, &quot;license:ccby&quot;, &quot;source@https://www.biology-pages.info/&quot; ]</div>`;
    expect(parseRenderedTags(html)).toEqual([
      'article:topic',
      'license:ccby',
      'source@https://www.biology-pages.info/',
    ]);
  });

  it('returns null when the page has no tag holder', () => {
    expect(parseRenderedTags('<html><body>nope</body></html>')).toBeNull();
  });
});
