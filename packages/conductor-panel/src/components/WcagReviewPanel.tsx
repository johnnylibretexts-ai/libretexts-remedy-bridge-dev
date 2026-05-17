import type {
  DojException,
  PageRef,
  WcagCriterionResult,
  WcagCriterionStatus,
  WcagPrinciple,
  WcagReview,
} from '@libretexts/remedy-core';

const PRINCIPLES: WcagPrinciple[] = ['Perceivable', 'Operable', 'Understandable', 'Robust'];

export function WcagReviewPanel({
  page,
  review,
  exceptions,
}: {
  page: PageRef;
  review: WcagReview;
  exceptions: DojException[];
}) {
  const summary = review.summary;
  const score = summary.score === null ? 'N/A' : `${summary.score}%`;

  return (
    <div className="wcag-review">
      <div className="wcag-page-row">
        <div className="wcag-page-main">
          <div className="wcag-page-title">{page.path}</div>
          <div className="muted">{page.hostname} - scanned {review.scannedAt}</div>
        </div>
        <div className="wcag-summary">
          <Metric label="score" value={score} tone={summary.scoreFailCount > 0 ? 'warn' : 'ok'} />
          <Metric label="fail" value={summary.failCount} tone={summary.failCount > 0 ? 'error' : 'ok'} />
          <Metric label="manual" value={summary.manualReviewCount} tone={summary.manualReviewCount > 0 ? 'warn' : 'ok'} />
          <Metric label="not tested" value={summary.notTestedCount} tone={summary.notTestedCount > 0 ? 'warn' : 'ok'} />
          <Metric label="exceptions" value={summary.verifiedExceptionCount} tone={summary.verifiedExceptionCount > 0 ? 'info' : 'neutral'} />
        </div>
      </div>

      <details className="wcag-details" open>
        <summary>
          WCAG 2.1 A/AA criteria
          <span className="muted">
            {' '}({summary.passCount} pass, {summary.notApplicableCount} not applicable)
          </span>
        </summary>
        {PRINCIPLES.map((principle) => (
          <section className="wcag-principle" key={principle}>
            <h3>{principle}</h3>
            <div className="wcag-criteria-grid">
              {review.criteria
                .filter((criterion) => criterion.principle === principle)
                .map((criterion) => (
                  <CriterionRow criterion={criterion} key={criterion.id} />
                ))}
            </div>
          </section>
        ))}
      </details>

      {exceptions.length > 0 && (
        <details className="wcag-details">
          <summary>DOJ exceptions ({exceptions.length})</summary>
          <div className="wcag-exceptions">
            {exceptions.map((exception) => (
              <div className="wcag-exception" key={exception.id}>
                <StatusPill status={exception.status === 'verified' ? 'pass' : 'manual_review'} label={exception.status} />
                <b>{exception.type}</b>
                <span className="muted"> {exception.scope}</span>
                <div>{exception.reason}</div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function CriterionRow({ criterion }: { criterion: WcagCriterionResult }) {
  return (
    <div className={`wcag-criterion status-${criterion.status}`}>
      <div className="wcag-criterion-head">
        <StatusPill status={criterion.status} />
        <b>{criterion.id}</b>
        <span>{criterion.title}</span>
        <span className="wcag-level">{criterion.level}</span>
      </div>
      <div className="wcag-reason">{criterion.applicabilityReason}</div>
      {criterion.evidence.length > 0 && (
        <details className="wcag-evidence">
          <summary>{criterion.evidence.length} evidence item(s)</summary>
          <ul>
            {criterion.evidence.slice(0, 6).map((evidence) => (
              <li key={`${criterion.id}-${evidence.findingId}`}>
                <span className={`sev ${evidence.severity}`}>{evidence.severity}</span>
                <b>{evidence.ruleId}</b>
                {evidence.fixable && <span className="muted"> fixable</span>}
                <div>{evidence.message}</div>
                {evidence.selector && <code>{evidence.selector}</code>}
              </li>
            ))}
            {criterion.evidence.length > 6 && (
              <li className="muted">... {criterion.evidence.length - 6} more</li>
            )}
          </ul>
        </details>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: 'ok' | 'warn' | 'error' | 'info' | 'neutral';
}) {
  return (
    <div className={`wcag-metric ${tone}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function StatusPill({
  status,
  label,
}: {
  status: WcagCriterionStatus;
  label?: string;
}) {
  return <span className={`wcag-status status-${status}`}>{label ?? status.replace('_', ' ')}</span>;
}
