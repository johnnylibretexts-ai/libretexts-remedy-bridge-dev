import type { Rule } from '../types.js';

/**
 * WCAG 1.3.1 Info and Relationships — ordered/unordered lists need valid list
 * semantics. This flags authored HTML where lists contain non-`li` children or
 * where `li` elements are orphaned outside a list container.
 */
export const listStructureRule: Rule = {
  id: 'list-structure',
  wcag: '1.3.1',
  severity: 'warning',
  description: 'Ordered and unordered lists must use valid list/listitem structure.',

  detect(doc) {
    const findings: ReturnType<Rule['detect']> = [];
    const lists = Array.from(doc.querySelectorAll('ol, ul'));

    lists.forEach((list, index) => {
      const listType = list.tagName.toLowerCase() === 'ol' ? 'ol' : 'ul';
      const directElementChildren = Array.from(list.children);
      const invalidChildren = directElementChildren.filter((child) => {
        const tag = child.tagName.toLowerCase();
        return tag !== 'li' && tag !== 'script' && tag !== 'template' && tag !== 'style';
      });
      const hasListItems = directElementChildren.some(
        (child) => child.tagName.toLowerCase() === 'li',
      );

      if (invalidChildren.length === 0 && hasListItems) return;

      findings.push({
        message: `<${listType}> has invalid list structure.`,
        selector: `${listType}:nth-of-type(${index + 1})`,
        snippet: list.outerHTML.slice(0, 300),
        data: {
          reason: hasListItems ? 'invalid-child' : 'empty-list',
          listType,
          invalidChildren: invalidChildren.map((child) => child.tagName.toLowerCase()),
        },
      });
    });

    const listItems = Array.from(doc.querySelectorAll('li'));
    listItems.forEach((li, index) => {
      if (li.closest('ol, ul, menu')) return;
      findings.push({
        message: '<li> is not inside an ordered or unordered list.',
        selector: `li:nth-of-type(${index + 1})`,
        snippet: li.outerHTML.slice(0, 200),
        data: { reason: 'orphan-li', listType: 'unknown' },
      });
    });

    return findings;
  },
};
