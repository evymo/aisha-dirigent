export interface ProvenanceBadgeProps {
  /** The data source name (e.g. an ERP name, "MES telemetry", a plan). */
  source: string;
  /** How fresh the data is (already formatted, e.g. "4 min ago"). */
  freshness?: string;
  /** Flag the source as stale past its freshness threshold — turns the badge Warning. */
  stale?: boolean;
  /** Leading label. Key-first i18n: the shell passes its translated string;
   *  the default is only the honest fallback for label-less contexts. */
  sourceLabel?: string;
  /** Suffix appended when `stale` (translated by the shell). */
  staleLabel?: string;
}

/**
 * ProvenanceBadge — the small source·freshness chip attached to every data
 * value, chart and AI answer. The visible face of "trust through transparency":
 * no number without a source; stale sources are flagged.
 */
export const ProvenanceBadge = ({
  source,
  freshness,
  stale = false,
  sourceLabel = 'SRC:',
  staleLabel = '(stale)'
}: ProvenanceBadgeProps) => (
  <span className={stale ? 'rdl-prov rdl-prov--stale' : 'rdl-prov'}>
    <span>{sourceLabel}</span>
    <span className="rdl-prov__src">{source}</span>
    {freshness ? (
      <span>
        · {freshness}
        {stale ? ` ${staleLabel}` : ''}
      </span>
    ) : null}
  </span>
);
