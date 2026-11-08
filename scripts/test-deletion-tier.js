#!/usr/bin/env node
/**
 * Static checks for Deletion Tier (deletable / locked / permanent).
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api', 'delete-post.js'), 'utf8');
const mig = fs.readFileSync(path.join(root, 'migrations', '20261108_deletion_tier.sql'), 'utf8');

function assert(c, m) {
  if (!c) throw new Error(m);
  console.log('PASS · ' + m);
}

// Migration
assert(/deletion_tier/.test(mig), 'migration adds deletion_tier');
assert(/deletable/.test(mig) && /locked/.test(mig) && /permanent/.test(mig), 'migration allows three tiers');
assert(/posts_deletion_tier_check/.test(mig), 'migration check constraint');

// API security
assert(/DELETE_COST_FC/.test(api) && /50/.test(api), 'API delete cost 50 FC');
assert(/spendDeleteFc|spend.*delete/i.test(api), 'API spends FC server-side');
assert(/insufficient/.test(api), 'API surfaces insufficient FC');
assert(/moderation/.test(api) && /privacy/.test(api), 'API free reasons: moderation + privacy');
assert(/idempotency|findLedgerSpend|reused/.test(api), 'API idempotent spend');
assert(/!freeOverride && !isOwner|Only the owner/.test(api), 'API owner/admin gate');
assert(/deletion_tier/.test(api) && /del:/.test(api), 'API reads column + del: tag fallback');
assert(/legacyRequiresFc/.test(api), 'API preserves legacy timed paid-remove');
assert(!/amount:\s*body\.amount|body\.cost/.test(api.replace(/\/\/.*/g, '')), 'API does not trust client price blindly');

// Compose UI
assert(/Deletion Tier/.test(html), 'compose has Deletion Tier label');
assert(/post-deletion-tier-group/.test(html), 'compose deletion tier group');
assert(/data-tier="deletable"/.test(html) && /data-tier="locked"/.test(html) && /data-tier="permanent"/.test(html), 'three tier options');
assert(/Deletable — Free deletion/.test(html), 'deletable copy');
assert(/Locked — 50 FC to delete/.test(html), 'locked copy');
assert(/Permanent — 50 FC to delete/.test(html), 'permanent copy');
assert(/selectedDeletionTier='deletable'/.test(html) || /selectedDeletionTier=\"deletable\"/.test(html), 'default deletable');

// Client helpers
assert(/function postDeletionTier/.test(html), 'postDeletionTier helper');
assert(/function deletionRequiresFc/.test(html), 'deletionRequiresFc helper');
assert(/function withDeletionTierTag/.test(html), 'withDeletionTierTag helper');
assert(/del:/.test(html) && /withDeletionTierTag/.test(html), 'stores del: tag');
assert(/\/api\/delete-post/.test(html), 'client calls secure delete API');
assert(/Confirm · 50 FC/.test(html), 'confirm · 50 FC button copy');
assert(/Deleting this post costs/.test(html), 'confirm dialog copy');
assert(/secureDeletePost/.test(html), 'secureDeletePost client helper');
assert(/deletionTierBadgeHtml/.test(html), 'tier badge on posts');
assert(/Delete · 50 FC/.test(html), 'paid delete button label');
assert(/reason:'moderation'|reason:\"moderation\"|privacy/.test(html) || /moderation|privacy/.test(api), 'moderation/privacy path retained');

// publicTags hides del:
assert(/\/\^del:\//.test(html) || /\^del:/.test(html), 'publicTags filters del: tags');

// Legacy preserved
assert(/function isPaidRemovePost/.test(html), 'legacy isPaidRemovePost kept');
assert(/allowLocalFallback/.test(html), 'free delete can fall back if API down');

console.log('\nAll deletion-tier static checks passed');
