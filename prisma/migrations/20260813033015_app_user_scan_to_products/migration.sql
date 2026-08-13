-- スキャン機能は商品機能配下へ移動したため、権限キー scan を products に付け替える
UPDATE "AppUser"
SET "features" = ARRAY(SELECT DISTINCT unnest(array_replace("features", 'scan', 'products')))
WHERE 'scan' = ANY("features");
