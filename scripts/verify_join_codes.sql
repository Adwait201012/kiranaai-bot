-- Verify join codes map to the expected shop (run in Supabase SQL Editor)
SELECT owner_phone, shop_name, join_code, join_code_expires_at
FROM public.registered_shops
WHERE join_code IS NOT NULL
ORDER BY join_code_expires_at DESC NULLS LAST;

-- Find duplicate join codes (should return zero rows)
SELECT join_code, COUNT(*) AS cnt
FROM public.registered_shops
WHERE join_code IS NOT NULL
GROUP BY join_code
HAVING COUNT(*) > 1;
