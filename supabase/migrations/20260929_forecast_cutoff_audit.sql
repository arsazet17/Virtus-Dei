alter table public.possible_output_archive
  add column if not exists cutoff_at timestamptz,
  add column if not exists frozen_at timestamptz,
  add column if not exists source_screenshot_ids uuid[] not null default '{}',
  add column if not exists input_fingerprint text,
  add column if not exists excluded_late_screenshot_count integer not null default 0;
