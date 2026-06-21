# Loom methodology — consulting research patterns

Reference for building research canvases that mirror how a real consulting team
works. The model picks/adapts these; they are not a rigid SOP (咨询是灵活的).

## Card roles (canvas vocabulary)
- `core_question` — ONE per study: the central question + boundary. fields:
  `{basic_question, context, criteria_for_success, scope}`.
- `issue` — an issue/hypothesis in the issue tree. fields: `{issue, hypothesis,
  status}`. As research lands, update `status` (untested→supported/challenged/mixed).
- `research` — a (deep) research task that gathers evidence (desk/social/expert/...).
  Many-to-many with issues.
- `synthesis` — distills the connected research into a storyline (提炼/归纳), placed
  *after* research; supports multiple versions (抽卡).
- `output` — the deck/visualization deliverable (usually `slides`/`html`).

Edges are typed by the roles they join: decompose (core_question→issue), support
(issue→research), distill (research→synthesis), visualize (synthesis→output),
evidence (research→issue).

## Research modules (pick what the brief needs)
- **Desk research** (`web_search`) — market size, growth, regulation, competitor set.
- **Social listening** (`social_listening`) — platform-scoped buzz, sentiment,
  theme frequency. Always scope it: platforms, region, volume, recency.
- **Expert interviews** (`expert_network`) — channel reality, tacit knowledge,
  things not on the internet. The 一手/primary research consulting leans on.
- **User research** (`survey`,`interview`) — perception, satisfaction, JTBD,
  willingness-to-pay. Design sample + questionnaire as part of the node.
- **Competitor teardown** — positioning, pricing band, channel mix, messaging.
- **Channel mapping** — classify → select → extend channels; what each yields.

## The analysis library (the "二十种分析" — one card each, ~2-3 slides)
A single research question ("台湾用户怎么看昂跑") can be analyzed many ways. Offer
the relevant ones as analysis nodes or as `version`s of one node:
1. Mind/mental map (心智地图)         2. Satisfaction / NPS
3. Theme-frequency (提及分布)          4. Sentiment split
5. Competitor perception map          6. Price-value perception band
7. JTBD / use-occasion                 8. Persona segmentation
9. Purchase-journey / funnel           10. Channel preference
11. Driver/barrier (驱动-阻碍)          12. Brand association web
13. Whitespace / unmet-need           14. SWOT vs top competitor
15. Demand sizing (TAM/SAM/SOM)       16. Trend / momentum
17. Regional heat                      18. KOL/community influence
19. Repeat/loyalty signal              20. Scenario / what-if

For each, choose the right `content_type`: distributions→`chart` (bar/pie),
comparisons→`table` or grouped `chart`, maps/narratives→`markdown`, the final
synthesis→`slides`.

## Storyline =抽卡 (generate multiple versions)
The storyline (and the final deck) is subjective and context-bound — exactly the
case for 并发试错. Generate 2-4 versions of the orchestrator/output node, each a
distinct narrative spine, e.g.:
- **MVP-first**: cheapest path to test the market.
- **Risk-first**: lead with the biggest entry risk and how to de-risk.
- **Channel-first**: organize the whole story around channel strategy.
- **Consumer-first**: lead with the mental-model / unmet need.
The user picks the version that best fits their read of the client.

## Ready-made templates

### A. Market entry (市场进入)
`brief(input) → storyline(orchestrator) → {desk, social, expert} → synthesis(analysis) → deck(output)`
Storyline modules: market sizing, competitor set, consumer perception, channel
structure, pricing band, entry options. Deck = 3-step entry strategy.

### B. Brand / consumer research (品牌·用户研究)
`brief → storyline → {user_research, social, competitor} → synthesis → report`
Lead analyses: mental map, satisfaction, competitor perception map, whitespace.

### C. Commercial due diligence (CDD, for PE/VC)
`brief → storyline → {market_sizing, customer_interviews, competitor, channel} → synthesis → ic_memo`
Heavier on primary expert/customer interviews; output an IC-style memo.

### D. Growth strategy (增长战略)
`brief → storyline → {funnel_diagnostic, channel_analysis, cohort} → synthesis → growth_plan`
Lead analyses: funnel, driver/barrier, channel preference, scenario.

## Quality bar
- MECE modules, insight over raw data, every conclusion traceable (`sources`).
- Scope every research node (platform/region/volume/recency) — no boil-the-ocean.
- The deck tells one story; supporting analyses hang off it.
