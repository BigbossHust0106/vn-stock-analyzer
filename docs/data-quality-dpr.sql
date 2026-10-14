-- Read-only audit, intended grain: one stock / fiscal year or one stock / horizon / ranking run.
select r.horizon,count(*) as ranked,
 min((c.explanation->>'coverage')::numeric) as minimum_component_coverage,
 max((c.explanation->>'coverage')::numeric) as maximum_component_coverage,
 min((c.explanation->>'confidence')::numeric) as minimum_confidence
from rankings r join scores c on c.id=r.score_id
where r.model_version='top10-v1'
 and r.as_of=(select max(as_of) from ranking_runs where model_version='top10-v1')
group by r.horizon;

select s.symbol,y->>'year' as fiscal_year,
 y->>'roe' as roe,y->>'roic' as roic,y->>'grossMargin' as gross_margin,
 y->>'freeCashFlowVnd' as group_fcf_vnd,y->>'dividendsPaidVnd' as group_dividends_vnd,
 f.payload->'documentEvidence' as parent_document_observations
from financial_snapshots f join stocks s on s.id=f.stock_id,
 lateral jsonb_array_elements(f.payload->'annual') y
where s.symbol='DPR' order by fiscal_year;

select horizon,count(*) as excluded
from scores where model_version='top10-v1'
 and as_of=(select max(as_of) from ranking_runs where model_version='top10-v1')
 and not ranking_is_eligible(explanation) group by horizon;
