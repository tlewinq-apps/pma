-- Recordings: an `audio` source arrives with empty raw_text; the pipeline transcribes it before extracting feedback.
alter table sources drop constraint if exists sources_kind_check;
alter table sources add constraint sources_kind_check
  check (kind in ('paste','file','widget','slack','granola','posthog','marver_comment','audio'));

-- Recordings upload straight to the private uploads bucket through a signed URL; allow up to 50 MB each.
update storage.buckets set file_size_limit = 52428800 where id = 'uploads';
