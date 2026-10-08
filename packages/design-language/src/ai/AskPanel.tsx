import type { ReactNode } from 'react';
import { Button } from '../actions/Button';
import { ProvenanceBadge } from '../data/ProvenanceBadge';

export interface AskPanelProps {
  /** The natural-language question (plain Czech). */
  question: ReactNode;
  /** The grounded answer. Figures inside should be tabular mono. */
  answer?: ReactNode;
  /** Headline figures extracted from the answer. */
  figures?: ReadonlyArray<{ value: ReactNode; label: ReactNode; positive?: boolean }>;
  /** Source names — one provenance badge each. Never show an answer without a source. */
  sources?: ReadonlyArray<string>;
  /** Verification disclaimer shown in the footer. */
  disclaimer?: ReactNode;
  /** Placeholder for the follow-up input. */
  placeholder?: string;
  /** Eyebrow label for the panel head. */
  scope?: ReactNode;
  /** Follow-up input value (controlled). Omit `onChange` to render it read-only. */
  value?: string;
  onChange?: (value: string) => void;
  /** Submit the follow-up (Enter or the button). Absent = the input is decorative. */
  onSubmit?: () => void;
  /** Submit button label — a prop, never baked in: this package ships no locale. */
  submitLabel?: ReactNode;
  /** Answer in flight: the control disables itself rather than queueing questions. */
  busy?: boolean;
  /**
   * Knowledge passages the answer drew on — reference (`K1`), source name and a short excerpt.
   * `cited` marks the passages the answer actually referenced.
   */
  passages?: ReadonlyArray<{ ref: string; source: string; excerpt: ReactNode; cited?: boolean }>;
  /** Heading of the passages list — a prop, never baked in: this package ships no locale. */
  passagesLabel?: ReactNode;
  /**
   * A LOUD state the reader must see (e.g. knowledge search unavailable). Never rendered as
   * an empty result: an outage that reads as "nothing found" is worse than an error.
   */
  notice?: ReactNode;
}

/**
 * AskPanel — the ask-data "Story loop": a question, a concise grounded answer,
 * the figures with provenance badges, and a follow-up input. Never an answer
 * without a source.
 */
export const AskPanel = ({
  question,
  answer,
  figures = [],
  sources = [],
  disclaimer = 'Verify against source records before deciding.',
  placeholder = 'Ask anything about your data…',
  scope = 'Data query · all sources',
  value,
  onChange,
  onSubmit,
  submitLabel = 'Ask',
  busy = false,
  passages = [],
  passagesLabel,
  notice,
}: AskPanelProps) => (
  <div className="rdl-ask">
    <div className="rdl-ask__head">
      <span className="rdl-dot" />
      <span className="rdl-overline">{scope}</span>
    </div>
    <div className="rdl-ask__q">{question}</div>
    {answer || figures.length ? (
      <div className="rdl-ask__a">
        {answer}
        {figures.length ? (
          <div className="rdl-ask__figs">
            {figures.map((f, i) => (
              <div key={i}>
                <div className={f.positive ? 'rdl-ask__n rdl-ask__n--up' : 'rdl-ask__n'}>{f.value}</div>
                <div className="rdl-ask__l">{f.label}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    ) : null}
    {notice ? (
      <div className="rdl-ask__notice" role="status">
        {notice}
      </div>
    ) : null}
    {passages.length ? (
      <div className="rdl-ask__passages">
        {passagesLabel ? <div className="rdl-overline">{passagesLabel}</div> : null}
        <ol>
          {passages.map((p) => (
            <li key={p.ref} className={p.cited ? 'rdl-ask__passage rdl-ask__passage--cited' : 'rdl-ask__passage'}>
              <span className="rdl-ask__ref">[{p.ref}]</span>
              <ProvenanceBadge source={p.source} />
              <span className="rdl-ask__excerpt">{p.excerpt}</span>
            </li>
          ))}
        </ol>
      </div>
    ) : null}
    {sources.length || disclaimer ? (
      <div className="rdl-ask__foot">
        {sources.map((src) => (
          <ProvenanceBadge key={src} source={src} />
        ))}
        {disclaimer ? (
          <span className="rdl-muted" style={{ fontSize: 11 }}>
            {disclaimer}
          </span>
        ) : null}
      </div>
    ) : null}
    <div className="rdl-ask__input">
      <input
        className="rdl-input"
        placeholder={placeholder}
        value={value}
        readOnly={!onChange}
        disabled={busy}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        /* Enter submits: asking a follow-up is the panel's whole purpose, and
           reaching for the mouse to ask a second question breaks the loop. */
        onKeyDown={onSubmit ? (e) => { if (e.key === 'Enter') onSubmit(); } : undefined}
      />
      <Button variant="primary" onClick={onSubmit} disabled={busy || !onSubmit}>
        {submitLabel}
      </Button>
    </div>
  </div>
);
