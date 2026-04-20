export type Severity = 'error' | 'warning' | 'info';

export interface PageRef {
  id: number;
  path: string;
  title?: string;
  hostname: string;
}

export interface Finding {
  ruleId: string;
  wcag?: string;
  severity: Severity;
  message: string;
  selector?: string;
  snippet?: string;
  source: 'remedy' | 'cxone-health';
  fixable: boolean;
  data?: Record<string, unknown>;
}

export interface ScanResult {
  page: PageRef;
  scannedAt: string;
  findings: Finding[];
  stats: {
    total: number;
    byRule: Record<string, number>;
    bySeverity: Record<Severity, number>;
  };
}

export type FixMode = 'preview' | 'apply';

export interface FixResult {
  page: PageRef;
  mode: FixMode;
  attempted: string[];
  applied: string[];
  before: string;
  after: string;
  diff: string;
  written: boolean;
  revisionSummary?: string;
}

export interface Rule {
  id: string;
  wcag?: string;
  severity: Severity;
  description: string;
  detect(doc: Document): Array<Omit<Finding, 'ruleId' | 'wcag' | 'severity' | 'source' | 'fixable'>>;
  fix?(doc: Document, finding: Finding, ctx: FixContext): Promise<boolean> | boolean;
}

export interface FixContext {
  page: PageRef;
  env: NodeJS.ProcessEnv;
}
