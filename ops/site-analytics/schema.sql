CREATE TABLE IF NOT EXISTS daily_events (
  day TEXT NOT NULL,
  event TEXT NOT NULL,
  page TEXT NOT NULL,
  source TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0 CHECK(count >= 0),
  PRIMARY KEY(day,event,page,source,version)
) WITHOUT ROWID;

CREATE VIEW IF NOT EXISTS summary_30_days AS
SELECT event, page, source, version, SUM(count) AS events
FROM daily_events WHERE day >= date('now','-29 days')
GROUP BY event,page,source,version;

CREATE VIEW IF NOT EXISTS product_funnel_30_days AS
SELECT
  SUM(CASE WHEN event='page_view' AND page='/slendystuffclicker/' THEN count ELSE 0 END) AS product_page_views,
  SUM(CASE WHEN event='download_click' THEN count ELSE 0 END) AS download_clicks,
  SUM(CASE WHEN event='setup_click' THEN count ELSE 0 END) AS setup_guide_clicks,
  SUM(CASE WHEN event='video_play' THEN count ELSE 0 END) AS video_plays,
  SUM(CASE WHEN event='video_complete' THEN count ELSE 0 END) AS video_completions,
  SUM(CASE WHEN event='feedback_accepted' THEN count ELSE 0 END) AS accepted_feedback
FROM daily_events WHERE day >= date('now','-29 days');
