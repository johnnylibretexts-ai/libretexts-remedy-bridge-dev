import type { Finding } from './types.js';
import { wcagCriterionIdsForFinding } from './wcag.js';

export const conductorScanKeys = [
  'imgAltText',
  'imgDecorative',
  'imgShortAlt',
  'headingNoneEmpty',
  'headingOutline',
  'formFieldLabels',
  'tableHeaders',
  'tableLabel',
  'listOlLabel',
  'listUlLabel',
  'linkNoneEmpty',
  'linkSuspicious',
  'linkExtLabeled',
  'docLinkFile',
] as const;

export type ConductorScanKey = (typeof conductorScanKeys)[number];

export interface ConductorFinding extends Finding {
  id: string;
  kind: string;
  criteria_keys: ConductorScanKey[];
  wcag_criterion_ids: string[];
  wcagCriterionIds: string[];
}

export type ConductorCriteria = Record<ConductorScanKey, boolean>;

export function toConductorFindings(findings: Finding[]): ConductorFinding[] {
  let fixableIndex = 0;
  return findings.map((finding, index) => {
    const id = finding.fixable
      ? `${finding.ruleId}#${fixableIndex++}`
      : `${finding.ruleId}#all-${index}`;
    const wcagCriterionIds = wcagCriterionIdsForFinding(finding);
    return {
      ...finding,
      id,
      kind: conductorKindForFinding(finding),
      criteria_keys: conductorCriteriaKeysForFinding(finding),
      wcag_criterion_ids: wcagCriterionIds,
      wcagCriterionIds,
    };
  });
}

export function buildConductorCriteria(findings: Finding[]): ConductorCriteria {
  const criteria = Object.fromEntries(
    conductorScanKeys.map((key) => [key, true]),
  ) as ConductorCriteria;

  for (const finding of findings) {
    for (const key of conductorCriteriaKeysForFinding(finding)) {
      criteria[key] = false;
    }
  }

  return criteria;
}

export function conductorCriteriaKeysForFinding(finding: Finding): ConductorScanKey[] {
  const axeRuleId = String(finding.data?.axeRuleId ?? '');
  switch (finding.ruleId) {
    case 'img-alt':
      return imageCriteriaKeys(String(finding.data?.reason ?? ''));
    case 'chart-alt':
    case 'figure-wrap':
    case 'math-accessible':
    case 'axe/image-alt':
    case 'axe/area-alt':
    case 'axe/input-image-alt':
    case 'axe/object-alt':
    case 'axe/role-img-alt':
      return ['imgAltText'];
    case 'heading-order':
      return headingCriteriaKeys(String(finding.data?.reason ?? ''));
    case 'axe/empty-heading':
      return ['headingNoneEmpty'];
    case 'form-label':
    case 'axe/label':
    case 'axe/aria-input-field-name':
    case 'axe/select-name':
      return ['formFieldLabels'];
    case 'table-header':
    case 'table-structure':
    case 'axe/empty-table-header':
    case 'axe/td-has-header':
    case 'axe/th-has-data-cells':
      return ['tableHeaders'];
    case 'table-label':
    case 'axe/table-duplicate-name':
    case 'axe/table-fake-caption':
      return ['tableLabel'];
    case 'list-structure':
      return listCriteriaKeys(String(finding.data?.listType ?? 'unknown'));
    case 'axe/list':
      return listCriteriaKeys(listTypeFromSnippet(finding.snippet));
    case 'axe/listitem':
      return ['listOlLabel', 'listUlLabel'];
    case 'link-text-descriptive':
      return linkCriteriaKeys(String(finding.data?.reason ?? ''));
    case 'axe/link-name':
      return ['linkNoneEmpty'];
    case 'document-link-filetype':
      return ['docLinkFile'];
    default:
      if (axeRuleId === 'empty-heading') return ['headingNoneEmpty'];
      if (axeRuleId === 'link-name') return ['linkNoneEmpty'];
      if (axeRuleId === 'label' || axeRuleId === 'aria-input-field-name') {
        return ['formFieldLabels'];
      }
      if (axeRuleId === 'table-duplicate-name' || axeRuleId === 'table-fake-caption') {
        return ['tableLabel'];
      }
      if (axeRuleId.startsWith('table-')) return ['tableHeaders'];
      if (axeRuleId === 'list') return listCriteriaKeys(listTypeFromSnippet(finding.snippet));
      if (axeRuleId === 'listitem') return ['listOlLabel', 'listUlLabel'];
      if (axeRuleId.endsWith('-alt')) return ['imgAltText'];
      return [];
  }
}

function conductorKindForFinding(finding: Finding): string {
  switch (finding.ruleId) {
    case 'img-alt':
      return imageKind(String(finding.data?.reason ?? ''));
    case 'chart-alt':
    case 'figure-wrap':
    case 'math-accessible':
    case 'axe/image-alt':
    case 'axe/area-alt':
    case 'axe/input-image-alt':
    case 'axe/object-alt':
    case 'axe/role-img-alt':
      return 'img-alt-missing';
    case 'heading-order':
      return String(finding.data?.reason) === 'empty'
        ? 'heading-empty'
        : 'heading-skipped-level';
    case 'axe/empty-heading':
      return 'heading-empty';
    case 'form-label':
    case 'axe/label':
    case 'axe/aria-input-field-name':
    case 'axe/select-name':
      return 'form-label-missing';
    case 'table-header':
    case 'table-structure':
    case 'axe/empty-table-header':
    case 'axe/td-has-header':
    case 'axe/th-has-data-cells':
      return 'table-header-missing';
    case 'table-label':
    case 'axe/table-duplicate-name':
    case 'axe/table-fake-caption':
      return 'table-label-missing';
    case 'list-structure':
    case 'axe/list':
    case 'axe/listitem':
      return 'list-structure-invalid';
    case 'link-text-descriptive':
      return linkKind(String(finding.data?.reason ?? ''));
    case 'axe/link-name':
      return 'link-empty';
    case 'document-link-filetype':
      return 'document-link-filetype-missing';
    default:
      return finding.ruleId.replace(/^axe\//, 'axe-');
  }
}

function imageCriteriaKeys(reason: string): ConductorScanKey[] {
  if (reason === 'suspect-decorative') return ['imgDecorative'];
  if (reason === 'long-alt') return ['imgShortAlt'];
  return ['imgAltText'];
}

function imageKind(reason: string): string {
  if (reason === 'suspect-decorative') return 'img-decorative-suspect';
  if (reason === 'long-alt') return 'img-alt-too-long';
  return 'img-alt-missing';
}

function headingCriteriaKeys(reason: string): ConductorScanKey[] {
  if (reason === 'empty') return ['headingNoneEmpty'];
  if (reason === 'skipped-level') return ['headingOutline'];
  return ['headingNoneEmpty', 'headingOutline'];
}

function linkCriteriaKeys(reason: string): ConductorScanKey[] {
  if (reason === 'empty-text') return ['linkNoneEmpty'];
  if (reason === 'bare-url' || reason === 'generic-phrase') return ['linkSuspicious'];
  if (reason === 'external-unlabeled') return ['linkExtLabeled'];
  return ['linkNoneEmpty', 'linkSuspicious'];
}

function linkKind(reason: string): string {
  if (reason === 'empty-text') return 'link-empty';
  if (reason === 'bare-url') return 'link-bare-url';
  if (reason === 'external-unlabeled') return 'link-external-unlabeled';
  return 'link-generic';
}

function listCriteriaKeys(listType: string): ConductorScanKey[] {
  if (listType === 'ol') return ['listOlLabel'];
  if (listType === 'ul') return ['listUlLabel'];
  return ['listOlLabel', 'listUlLabel'];
}

function listTypeFromSnippet(snippet: string | undefined): string {
  const normalized = (snippet ?? '').trim().toLowerCase();
  if (normalized.startsWith('<ol')) return 'ol';
  if (normalized.startsWith('<ul')) return 'ul';
  return 'unknown';
}
