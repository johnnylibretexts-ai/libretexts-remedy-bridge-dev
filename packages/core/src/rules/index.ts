import type { Rule } from '../types.js';
import { imgAltRule } from './img-alt.js';
import { headingOrderRule } from './heading-order.js';
import { headingAsBoldRule } from './heading-as-bold.js';
import { linkTextRule } from './link-text.js';
import { tableHeaderRule } from './table-header.js';
import { duplicateIdRule } from './duplicate-id.js';
import { mathAccessibleRule } from './math-accessible.js';
import { chartAltRule } from './chart-alt.js';
import { figureWrapRule } from './figure-wrap.js';
import { tableStructureRule } from './table-structure.js';
import { formLabelRule } from './form-label.js';
import { tableLabelRule } from './table-label.js';
import { listStructureRule } from './list-structure.js';
import { documentLinkRule } from './document-link.js';

export const defaultRules: Rule[] = [
  imgAltRule,
  headingOrderRule,
  headingAsBoldRule,
  linkTextRule,
  tableHeaderRule,
  duplicateIdRule,
  mathAccessibleRule,
  chartAltRule,
  figureWrapRule,
  tableStructureRule,
  formLabelRule,
  tableLabelRule,
  listStructureRule,
  documentLinkRule,
];

export {
  imgAltRule,
  headingOrderRule,
  headingAsBoldRule,
  linkTextRule,
  tableHeaderRule,
  duplicateIdRule,
  mathAccessibleRule,
  chartAltRule,
  figureWrapRule,
  tableStructureRule,
  formLabelRule,
  tableLabelRule,
  listStructureRule,
  documentLinkRule,
};
