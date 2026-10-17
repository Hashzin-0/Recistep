-- Allow generated SVG flowcharts in the existing recipe media bucket.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/svg+xml']::text[]
WHERE id = 'recipe-media';
