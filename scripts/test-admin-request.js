#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'admin-request.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function assert(c, m){ if(!c) throw new Error(m); console.log('PASS · '+m); }

assert(api.includes("ALLOWED_KINDS"), 'api allowlist');
assert(api.includes('remove_request') && api.includes('pin_payment_request'), 'api covers remove+pin');
assert(api.includes('/notifs') && api.includes('/requests'), 'api fans out request+notifs');
assert(api.includes('notify_only') || api.includes('notif_only'), 'api notify-only mode');
assert(html.includes('/api/admin-request'), 'SPA uses same-origin admin-request proxy');
assert(html.includes('fetchWithTimeout'), 'SPA fetch timeout helper');
assert(html.includes('__removeRequestLocks'), 'remove request lock');
assert(html.includes("kind:'remove_request'") && html.includes('notifyAdminPayment'), 'remove paid notifies admin');
assert(html.includes('Sending delete request') || html.includes('Sending request'), 'remove request status UX');
assert(!/pinRequestProgress\(20,\s*'Notifying admin/.test(html), 'delete request no longer uses % progress ladder');
assert(!/payProgress\(true,\s*'Delete[^']*',\s*'Sending request to admin…',\s*70\)/.test(html), 'no fake 70% bar on FC delete request');
assert(html.includes('/api/request-delete'), 'atomic request-delete endpoint used');
console.log('\\nAdmin request static checks passed');
