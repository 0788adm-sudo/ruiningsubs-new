// Game task catalog + points economy (independent of Coins).
// Boards mirror: __GAME_TASK_CATALOG__, __GAME_TASK_PROGRESS__, __GAME_POINTS__,
// __GAME_REWARD_DEFS__. Does NOT touch PayPal / Throne / Coins wallet flows.
// Public exposure rewards stay disabled until admin enables + publishes.

const CF_API = process.env.CF_API || 'https://ruiningsubs-api.0788adm.workers.dev';
const SITE = process.env.SITE_URL || 'https://www.ruinexpose.com';

const BOARD_CATALOG = '__GAME_TASK_CATALOG__';
const BOARD_PROGRESS = '__GAME_TASK_PROGRESS__';
const BOARD_POINTS = '__GAME_POINTS__';
const BOARD_REWARDS = '__GAME_REWARD_DEFS__';
const BOARD_REDEEMS = '__GAME_REWARD_REDEEMS__';

const LIVE_GAMES = { roulette: 1, dice: 1, tic_tac_toe: 1, all: 1 };
const PROOF_TYPES = { photo: 1, video: 1, link: 1, wall_post: 1, admin_verify: 1 };
const DIFFICULTIES = { easy: 1, medium: 1, hard: 1, extreme: 1 };
const PROGRESS_STATUSES = {
  available: 1,
  in_progress: 1,
  pending_review: 1,
  completed: 1,
  rejected: 1
};

/** Seed catalog — expandable without rebuilding games. IDs are stable. */
var SEED_CATALOG = [
  // —— Digital publication / exposure ——
  { id: 'pub_wall_photo', name: 'Upload to the Wall', description: 'Publish one clear photo on the Wall with a short caption.', requirements: 'Photo post on Wall · visible face or body as required by caption', game: 'all', category: 'publication', difficulty: 'easy', points: 15, proof_type: 'wall_post', sort_order: 10 },
  { id: 'pub_share_x', name: 'Share a public link on X', description: 'Publish a post on Ruining Subs, then share its public link on Twitter/X.', requirements: 'Public Wall/post URL + X/Twitter share link', game: 'all', category: 'publication', difficulty: 'medium', points: 40, proof_type: 'link', sort_order: 20 },
  { id: 'pub_share_profile', name: 'Share your profile', description: 'Share your Ruining Subs profile on your social media.', requirements: 'Screenshot or link proving the share', game: 'all', category: 'publication', difficulty: 'easy', points: 25, proof_type: 'link', sort_order: 30 },
  { id: 'pub_video_challenge', name: 'Publish a challenge video', description: 'Record yourself completing a challenge and publish the video.', requirements: 'Video post · challenge named in caption', game: 'all', category: 'publication', difficulty: 'hard', points: 60, proof_type: 'video', sort_order: 40 },
  { id: 'pub_invite_user', name: 'Invite another user', description: 'Invite another person to join and participate.', requirements: 'Invite proof (message / link / username of invitee)', game: 'all', category: 'publication', difficulty: 'medium', points: 35, proof_type: 'admin_verify', sort_order: 50 },

  // —— Pose / photo ——
  { id: 'pose_specific', name: 'Complete a specific pose', description: 'Hold the designated pose clearly for the camera.', requirements: 'One clear photo of the pose', game: 'dice', category: 'pose', difficulty: 'easy', points: 20, proof_type: 'photo', sort_order: 60 },
  { id: 'pose_three_angles', name: 'Three angles', description: 'Take three photographs from different angles of the same pose.', requirements: 'Three photos · same outfit/pose · different angles', game: 'dice', category: 'pose', difficulty: 'medium', points: 35, proof_type: 'photo', sort_order: 70 },
  { id: 'pose_recreate_dice', name: 'Recreate the dice pose', description: 'Recreate the Wear + Pose selected by Exposure Dice and publish proof.', requirements: 'Photo matching last dice Wear/Pose', game: 'dice', category: 'pose', difficulty: 'medium', points: 30, proof_type: 'wall_post', sort_order: 80 },
  { id: 'pose_wall_proof', name: 'Photographic proof on the Wall', description: 'Publish photographic proof of your pose challenge on the Wall.', requirements: 'Wall photo post tagged as dice/pose proof', game: 'dice', category: 'pose', difficulty: 'easy', points: 20, proof_type: 'wall_post', sort_order: 90 },
  { id: 'pose_mirror', name: 'Mirror inspection', description: 'Mirror selfie holding inspection pose — hands behind head.', requirements: 'Mirror photo · face optional per caption rules', game: 'dice', category: 'pose', difficulty: 'easy', points: 18, proof_type: 'photo', sort_order: 95 },

  // —— Obedience / consensual humiliation ——
  { id: 'obey_instruction', name: 'Follow a specific instruction', description: 'Follow the written instruction exactly and submit proof.', requirements: 'Photo or video matching the instruction', game: 'roulette', category: 'obedience', difficulty: 'medium', points: 30, proof_type: 'photo', sort_order: 100 },
  { id: 'obey_designated', name: 'Complete a designated challenge', description: 'Complete the challenge landed on the wheel and publish proof.', requirements: 'Proof matching the roulette task text', game: 'roulette', category: 'obedience', difficulty: 'medium', points: 35, proof_type: 'wall_post', sort_order: 110 },
  { id: 'obey_record', name: 'Record yourself completing a challenge', description: 'Record a short video completing a designated challenge.', requirements: 'Video ≤ 60s · challenge named in caption', game: 'roulette', category: 'obedience', difficulty: 'hard', points: 55, proof_type: 'video', sort_order: 120 },
  { id: 'obey_publish_proof', name: 'Publish proof of completion', description: 'Publish proof that you completed your accepted challenge.', requirements: 'Wall post with proof media', game: 'roulette', category: 'obedience', difficulty: 'easy', points: 20, proof_type: 'wall_post', sort_order: 130 },
  { id: 'obey_written_apology', name: 'Written apology on camera', description: 'Write RUINED on paper, hold it on camera, and publish.', requirements: 'Photo with handwritten RUINED visible', game: 'roulette', category: 'obedience', difficulty: 'easy', points: 22, proof_type: 'photo', sort_order: 140 },

  // —— Tic-Tac-Toe / defeat ——
  { id: 'ttt_defeat_photo', name: 'Defeat photo', description: 'After a Triki loss, publish a clear defeat photo on the Wall.', requirements: 'Photo proof · caption mentions Tic-Tac-Toe defeat', game: 'tic_tac_toe', category: 'defeat', difficulty: 'easy', points: 20, proof_type: 'wall_post', sort_order: 150 },
  { id: 'ttt_defeat_video', name: 'Defeat video', description: 'Record a short apology/defeat video after losing Triki.', requirements: 'Video ≤ 45s · mention the loss', game: 'tic_tac_toe', category: 'defeat', difficulty: 'medium', points: 40, proof_type: 'video', sort_order: 160 },
  { id: 'ttt_three_wins_boast', name: 'Three-win boast', description: 'If you win a 3-game Triki session, publish a victory boast post.', requirements: 'Wall post celebrating 3 wins', game: 'tic_tac_toe', category: 'victory', difficulty: 'medium', points: 45, proof_type: 'wall_post', sort_order: 170 },
  { id: 'ttt_kneel_photo', name: 'Kneel after defeat', description: 'Kneeling photo after a Triki loss — hands on thighs.', requirements: 'Kneeling photo · clear lighting', game: 'tic_tac_toe', category: 'defeat', difficulty: 'easy', points: 25, proof_type: 'photo', sort_order: 180 },

  // —— Progressive / harder ——
  { id: 'prog_daily_wall', name: 'Daily Wall proof', description: 'Publish one proof post on the Wall today.', requirements: 'One Wall post today', game: 'all', category: 'progressive', difficulty: 'easy', points: 12, proof_type: 'wall_post', sort_order: 200 },
  { id: 'prog_week_streak', name: 'Three proofs in a week', description: 'Complete three proof posts within seven days.', requirements: 'Three approved proofs · admin verify streak', game: 'all', category: 'progressive', difficulty: 'hard', points: 80, proof_type: 'admin_verify', sort_order: 210 },
  { id: 'prog_public_caption', name: 'Public exposure caption', description: 'Publish a post with an explicit exposure caption naming Ruining Subs.', requirements: 'Wall post · caption includes ruiningsubs / ruinexpose', game: 'all', category: 'progressive', difficulty: 'medium', points: 28, proof_type: 'wall_post', sort_order: 220 },
  { id: 'prog_video_hold', name: 'Hold and count', description: 'Hold a pose and count out loud to 15 on video, then publish.', requirements: 'Video with audible count', game: 'dice', category: 'progressive', difficulty: 'medium', points: 38, proof_type: 'video', sort_order: 230 },
  { id: 'prog_multi_game', name: 'Cross-game proof', description: 'Complete one proof from Roulette and one from Dice (any order).', requirements: 'Two proofs · different games · admin verify', game: 'all', category: 'progressive', difficulty: 'hard', points: 70, proof_type: 'admin_verify', sort_order: 240 },

  // —— Social / community ——
  { id: 'soc_comment_support', name: 'Comment on a Wall post', description: 'Leave a supportive or obedient comment on another user’s Wall post.', requirements: 'Link or screenshot of your comment', game: 'all', category: 'social', difficulty: 'easy', points: 10, proof_type: 'link', sort_order: 250 },
  { id: 'soc_feature_request', name: 'Nominate for spotlight', description: 'Nominate another post for spotlight (admin reviews).', requirements: 'Post ID + reason', game: 'all', category: 'social', difficulty: 'easy', points: 15, proof_type: 'admin_verify', sort_order: 260 }
];

/** Future star product — scaffolding only. Never publish/redeem by default. */
var SEED_REWARDS = [
  {
    id: 'exposure_public_slot',
    name: 'Public exposure slot',
    description: 'Future: redeem points for a public exposure opportunity.',
    points_cost: 500,
    kind: 'exposure',
    enabled: false,
    published: false
  },
  {
    id: 'exposure_recording',
    name: 'Public recording session',
    description: 'Future: redeem points to participate in a funded recording. Not active.',
    points_cost: 2000,
    kind: 'recording',
    enabled: false,
    published: false
  },
  {
    id: 'exposure_visibility',
    name: 'Special visibility boost',
    description: 'Future: temporary visibility opportunity. Not active.',
    points_cost: 300,
    kind: 'visibility',
    enabled: false,
    published: false
  }
];

var locks = new Map();

function json(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    var chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () {
      try {
        var raw = Buffer.concat(chunks).toString('utf8') || '{}';
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function normUser(u) {
  return String(u || '').replace(/^@/, '').trim().toLowerCase().slice(0, 64);
}

function normalizeGame(game) {
  game = String(game || '').toLowerCase().trim();
  if (game === 'triki') return 'tic_tac_toe';
  return game;
}

function parseMsg(raw) {
  try {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    return JSON.parse(String(raw));
  } catch (e) {
    return null;
  }
}

async function cfFetch(path, opts) {
  var r = await fetch(CF_API + path, opts);
  var j = await r.json().catch(function () { return {}; });
  return { ok: r.ok, status: r.status, json: j };
}

async function fetchBoard(board) {
  var res = await cfFetch('/notifs?board=' + encodeURIComponent(board) + '&limit=500', { cache: 'no-store' });
  return (res.json && (res.json.notifications || res.json.notifs || res.json.data)) || [];
}

async function postBoard(board, from, type, postId, message) {
  return cfFetch('/notifs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SITE },
    body: JSON.stringify({
      board: board,
      to_username: board,
      from_username: from || 'system',
      type: type,
      post_id: postId || null,
      message: typeof message === 'string' ? message : JSON.stringify(message || {})
    })
  });
}

function bearerToken(req) {
  var h = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
  var m = h.match(/^Bearer\s+(.+)$/i);
  return m ? String(m[1] || '').trim() : '';
}

async function verifyAdminToken(token) {
  if (!token) return false;
  var res = await cfFetch('/admin/requests?limit=1', {
    headers: { Authorization: 'Bearer ' + token, Origin: SITE }
  });
  return !!(res.ok && res.json && res.json.ok !== false);
}

function normalizeTask(raw) {
  if (!raw || !raw.id) return null;
  var game = normalizeGame(raw.game || 'all');
  if (!LIVE_GAMES[game]) game = 'all';
  var proof = String(raw.proof_type || raw.proofType || 'photo').toLowerCase();
  if (!PROOF_TYPES[proof]) proof = 'photo';
  var diff = String(raw.difficulty || 'easy').toLowerCase();
  if (!DIFFICULTIES[diff]) diff = 'easy';
  return {
    id: String(raw.id).slice(0, 80),
    name: String(raw.name || raw.title || 'Task').slice(0, 120),
    description: String(raw.description || raw.desc || '').slice(0, 2000),
    requirements: String(raw.requirements || raw.reqs || '').slice(0, 1000),
    game: game,
    category: String(raw.category || 'general').slice(0, 64),
    difficulty: diff,
    points: Math.max(0, Math.min(10000, Number(raw.points) || 0)),
    proof_type: proof,
    validation_rules: raw.validation_rules || raw.validationRules || {},
    active: raw.active !== false && raw.active !== 0 && raw.active !== '0',
    sort_order: Number(raw.sort_order != null ? raw.sort_order : raw.sortOrder) || 100,
    created_at: Number(raw.created_at || raw.createdAt || Date.now()) || Date.now(),
    updated_at: Number(raw.updated_at || raw.updatedAt || Date.now()) || Date.now()
  };
}

function catalogFromBoard(rows) {
  var byId = {};
  SEED_CATALOG.forEach(function (t) {
    var n = normalizeTask(t);
    if (n) byId[n.id] = n;
  });
  (rows || []).forEach(function (n) {
    var msg = parseMsg(n && n.message);
    if (!msg || msg.kind !== 'task_def') return;
    var task = normalizeTask(msg.task || msg);
    if (!task) return;
    // Board overrides seed (admin edits)
    byId[task.id] = Object.assign({}, byId[task.id] || {}, task, {
      created_at: (byId[task.id] && byId[task.id].created_at) || task.created_at
    });
  });
  return Object.keys(byId).map(function (k) { return byId[k]; })
    .sort(function (a, b) { return (a.sort_order - b.sort_order) || a.name.localeCompare(b.name); });
}

function rewardsFromBoard(rows) {
  var byId = {};
  SEED_REWARDS.forEach(function (r) { byId[r.id] = Object.assign({}, r); });
  (rows || []).forEach(function (n) {
    var msg = parseMsg(n && n.message);
    if (!msg || msg.kind !== 'reward_def') return;
    var id = String(msg.id || (msg.reward && msg.reward.id) || '').slice(0, 80);
    if (!id) return;
    var base = byId[id] || {};
    var r = msg.reward || msg;
    byId[id] = {
      id: id,
      name: String(r.name || base.name || id).slice(0, 120),
      description: String(r.description || base.description || '').slice(0, 2000),
      points_cost: Math.max(0, Number(r.points_cost != null ? r.points_cost : base.points_cost) || 0),
      kind: String(r.kind || base.kind || 'exposure'),
      enabled: !!(r.enabled === true || r.enabled === 1 || r.enabled === '1'),
      published: !!(r.published === true || r.published === 1 || r.published === '1'),
      config: r.config || base.config || {},
      updated_at: Number(r.updated_at || Date.now()) || Date.now()
    };
  });
  return Object.keys(byId).map(function (k) { return byId[k]; });
}

function progressRowsForUser(rows, user) {
  var out = [];
  (rows || []).forEach(function (n) {
    var msg = parseMsg(n && n.message);
    if (!msg || msg.kind !== 'task_progress') return;
    if (normUser(msg.username || msg.user || n.from_username) !== user) return;
    out.push(msg);
  });
  // Prefer latest by updated_at per task_id
  var byTask = {};
  out.forEach(function (p) {
    var tid = String(p.task_id || '');
    if (!tid) return;
    var prev = byTask[tid];
    if (!prev || Number(p.updated_at || 0) >= Number(prev.updated_at || 0)) byTask[tid] = p;
  });
  return Object.keys(byTask).map(function (k) { return byTask[k]; });
}

function pointsBalance(rows, user) {
  var bal = 0;
  var hist = [];
  (rows || []).forEach(function (n) {
    var msg = parseMsg(n && n.message);
    if (!msg || msg.kind !== 'points_event') return;
    if (normUser(msg.username || msg.user || n.from_username) !== user) return;
    hist.push(msg);
  });
  hist.sort(function (a, b) { return Number(a.at || 0) - Number(b.at || 0); });
  var seen = {};
  hist.forEach(function (m) {
    var key = String(m.action || '') + '|' + String(m.ref_id || '');
    if (seen[key]) return;
    seen[key] = 1;
    bal += Number(m.amount) || 0;
  });
  return { balance: Math.max(0, bal), history: hist.slice().reverse().slice(0, 100) };
}

function findPointsEvent(rows, user, action, refId) {
  for (var i = 0; i < (rows || []).length; i++) {
    var msg = parseMsg(rows[i] && rows[i].message);
    if (!msg || msg.kind !== 'points_event') continue;
    if (normUser(msg.username || msg.user || rows[i].from_username) !== user) continue;
    if (String(msg.action || '') !== String(action)) continue;
    if (String(msg.ref_id || '') !== String(refId)) continue;
    return msg;
  }
  return null;
}

function mergeCatalogStatus(catalog, progress) {
  var map = {};
  (progress || []).forEach(function (p) { map[String(p.task_id)] = p; });
  return (catalog || []).map(function (t) {
    var p = map[t.id];
    var status = 'available';
    if (p && PROGRESS_STATUSES[p.status]) status = p.status;
    return Object.assign({}, t, {
      status: status,
      progress_id: p ? p.id : null,
      evidence: p ? (p.evidence || {}) : {},
      evidence_post_id: p ? (p.evidence_post_id || null) : null,
      points_awarded: p ? (Number(p.points_awarded) || 0) : 0,
      selected_at: p ? p.selected_at : null,
      submitted_at: p ? p.submitted_at : null,
      reviewed_at: p ? p.reviewed_at : null,
      review_note: p ? (p.review_note || '') : ''
    });
  });
}

function statusLabel(st) {
  st = String(st || 'available');
  if (st === 'in_progress') return 'IN PROGRESS';
  if (st === 'pending_review') return 'PENDING REVIEW';
  if (st === 'completed') return 'COMPLETED';
  if (st === 'rejected') return 'REJECTED';
  return 'AVAILABLE';
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});

  var query = req.query || {};
  var body = {};
  if (req.method === 'POST') {
    try { body = await readBody(req); } catch (e) {
      return json(res, 400, { ok: false, error: 'invalid_json' });
    }
  }

  var action = String(body.action || query.action || (req.method === 'GET' ? 'list_catalog' : '')).toLowerCase();
  var user = normUser(body.user || body.username || query.user || query.username || '');
  var game = normalizeGame(body.game || query.game || '');

  try {
    // —— Public / user reads ——
    if (req.method === 'GET' || action === 'list_catalog' || action === 'catalog') {
      var catRows = await fetchBoard(BOARD_CATALOG);
      var catalog = catalogFromBoard(catRows).filter(function (t) { return t.active; });
      if (game && game !== 'all') {
        catalog = catalog.filter(function (t) { return t.game === game || t.game === 'all'; });
      }
      var progress = [];
      var points = { balance: 0, history: [] };
      if (user) {
        var progRows = await fetchBoard(BOARD_PROGRESS);
        progress = progressRowsForUser(progRows, user);
        var ptsRows = await fetchBoard(BOARD_POINTS);
        points = pointsBalance(ptsRows, user);
        catalog = mergeCatalogStatus(catalog, progress);
      }
      var rewardRows = await fetchBoard(BOARD_REWARDS);
      var rewards = rewardsFromBoard(rewardRows).filter(function (r) {
        // Never expose unpublished future rewards to end users
        return !!(r.published && r.enabled);
      });
      return json(res, 200, {
        ok: true,
        catalog: catalog,
        progress: progress,
        points: points.balance,
        points_history: points.history,
        rewards: rewards,
        rewards_enabled: false,
        exposure_rewards_active: false,
        status_labels: ['AVAILABLE', 'IN PROGRESS', 'PENDING REVIEW', 'COMPLETED', 'REJECTED']
      });
    }

    if (action === 'points_balance' || action === 'my_points') {
      if (!user) return json(res, 401, { ok: false, error: 'need_user' });
      var pts = pointsBalance(await fetchBoard(BOARD_POINTS), user);
      return json(res, 200, { ok: true, points: pts.balance, history: pts.history });
    }

    if (action === 'list_my_tasks' || action === 'my_tasks') {
      if (!user) return json(res, 401, { ok: false, error: 'need_user' });
      var cat = catalogFromBoard(await fetchBoard(BOARD_CATALOG)).filter(function (t) { return t.active; });
      if (game && game !== 'all') {
        cat = cat.filter(function (t) { return t.game === game || t.game === 'all'; });
      }
      var prog = progressRowsForUser(await fetchBoard(BOARD_PROGRESS), user);
      return json(res, 200, {
        ok: true,
        tasks: mergeCatalogStatus(cat, prog),
        progress: prog
      });
    }

    // —— User mutations ——
    if (action === 'select_task') {
      if (!user) return json(res, 401, { ok: false, error: 'need_user' });
      var taskId = String(body.task_id || body.taskId || '').trim().slice(0, 80);
      if (!taskId) return json(res, 400, { ok: false, error: 'need_task_id' });
      var lockKey = 'select|' + user + '|' + taskId;
      if (locks.get(lockKey)) return json(res, 409, { ok: false, error: 'in_progress' });
      locks.set(lockKey, Date.now());
      try {
        var allCat = catalogFromBoard(await fetchBoard(BOARD_CATALOG));
        var task = null;
        for (var i = 0; i < allCat.length; i++) {
          if (allCat[i].id === taskId && allCat[i].active) { task = allCat[i]; break; }
        }
        if (!task) return json(res, 404, { ok: false, error: 'task_not_found' });
        var progBoard = await fetchBoard(BOARD_PROGRESS);
        var existing = progressRowsForUser(progBoard, user).filter(function (p) { return p.task_id === taskId; })[0];
        if (existing && (existing.status === 'completed' || existing.status === 'pending_review' || existing.status === 'in_progress')) {
          return json(res, 200, {
            ok: true,
            reused: true,
            progress: existing,
            status: existing.status,
            status_label: statusLabel(existing.status),
            message: 'Selecting a task does not consume a play'
          });
        }
        var progressId = existing && existing.id
          ? existing.id
          : ('tp_' + user.slice(0, 12) + '_' + taskId + '_' + Date.now().toString(36));
        var payload = {
          kind: 'task_progress',
          id: progressId,
          username: user,
          user: user,
          task_id: taskId,
          game: task.game,
          status: 'in_progress',
          evidence: {},
          points_awarded: 0,
          selected_at: Date.now(),
          updated_at: Date.now(),
          created_at: (existing && existing.created_at) || Date.now()
        };
        await postBoard(BOARD_PROGRESS, user, 'task_select', progressId, payload);
        return json(res, 200, {
          ok: true,
          progress: payload,
          status: 'in_progress',
          status_label: 'IN PROGRESS',
          task: task,
          message: 'Task selected — no play consumed'
        });
      } finally {
        locks.delete(lockKey);
      }
    }

    if (action === 'submit_proof' || action === 'submit_task') {
      if (!user) return json(res, 401, { ok: false, error: 'need_user' });
      var sid = String(body.task_id || body.taskId || '').trim().slice(0, 80);
      if (!sid) return json(res, 400, { ok: false, error: 'need_task_id' });
      var lockS = 'submit|' + user + '|' + sid;
      if (locks.get(lockS)) return json(res, 409, { ok: false, error: 'in_progress' });
      locks.set(lockS, Date.now());
      try {
        var catAll = catalogFromBoard(await fetchBoard(BOARD_CATALOG));
        var tdef = null;
        for (var ti = 0; ti < catAll.length; ti++) {
          if (catAll[ti].id === sid && catAll[ti].active) { tdef = catAll[ti]; break; }
        }
        if (!tdef) return json(res, 404, { ok: false, error: 'task_not_found' });
        var progAll = progressRowsForUser(await fetchBoard(BOARD_PROGRESS), user);
        var cur = progAll.filter(function (p) { return p.task_id === sid; })[0];
        if (cur && cur.status === 'completed') {
          return json(res, 200, { ok: true, reused: true, status: 'completed', message: 'Already completed — points not re-awarded' });
        }
        var evidence = {
          proof_type: tdef.proof_type,
          post_id: String(body.post_id || body.postId || (body.evidence && body.evidence.post_id) || '').slice(0, 80) || null,
          url: String(body.url || body.link || (body.evidence && body.evidence.url) || '').slice(0, 500) || null,
          note: String(body.note || body.text || (body.evidence && body.evidence.note) || '').slice(0, 2000) || '',
          media_url: String(body.media_url || (body.evidence && body.evidence.media_url) || '').slice(0, 500) || null
        };
        if (tdef.proof_type === 'wall_post' && !evidence.post_id) {
          return json(res, 400, { ok: false, error: 'need_post_id', message: 'Wall post proof requires post_id' });
        }
        if (tdef.proof_type === 'link' && !evidence.url) {
          return json(res, 400, { ok: false, error: 'need_url', message: 'Link proof requires url' });
        }
        var needsAdmin = tdef.proof_type === 'admin_verify' || tdef.proof_type === 'link' || !!body.force_review;
        var autoApprove = !needsAdmin && (tdef.proof_type === 'wall_post' || tdef.proof_type === 'photo' || tdef.proof_type === 'video') && !!evidence.post_id;
        // Conservative: wall/photo/video with post_id still go to pending_review unless admin_auto flag
        if (!body.admin_auto) autoApprove = false;
        var nextStatus = autoApprove ? 'completed' : 'pending_review';
        var pid = (cur && cur.id) || ('tp_' + user.slice(0, 12) + '_' + sid + '_' + Date.now().toString(36));
        var submitPayload = {
          kind: 'task_progress',
          id: pid,
          username: user,
          user: user,
          task_id: sid,
          game: tdef.game,
          status: nextStatus,
          evidence: evidence,
          evidence_post_id: evidence.post_id,
          points_awarded: 0,
          selected_at: (cur && cur.selected_at) || Date.now(),
          submitted_at: Date.now(),
          updated_at: Date.now(),
          created_at: (cur && cur.created_at) || Date.now()
        };
        await postBoard(BOARD_PROGRESS, user, 'task_submit', pid, submitPayload);
        await postBoard('admin', user, 'task_proof_pending', pid, {
          user: user,
          task_id: sid,
          task_name: tdef.name,
          points: tdef.points,
          proof_type: tdef.proof_type,
          evidence: evidence,
          at: Date.now(),
          message: 'TASK PROOF · @' + user + ' · ' + tdef.name + ' · ' + tdef.points + ' pts'
        });
        return json(res, 200, {
          ok: true,
          status: nextStatus,
          status_label: statusLabel(nextStatus),
          progress: submitPayload,
          points_awarded: 0,
          message: nextStatus === 'pending_review'
            ? 'Proof submitted — pending review'
            : 'Completed'
        });
      } finally {
        locks.delete(lockS);
      }
    }

    // —— Admin ——
    var adminActions = {
      create_task: 1,
      update_task: 1,
      deactivate_task: 1,
      activate_task: 1,
      list_pending_reviews: 1,
      approve_submission: 1,
      reject_submission: 1,
      user_points: 1,
      list_all_tasks: 1,
      set_reward: 1,
      list_rewards: 1,
      set_category_active: 1
    };
    if (adminActions[action]) {
      var tok = bearerToken(req);
      var adminOk = false;
      try { adminOk = await verifyAdminToken(tok); } catch (e) { adminOk = false; }
      if (!adminOk) return json(res, 401, { ok: false, error: 'admin_required' });

      if (action === 'list_all_tasks') {
        var full = catalogFromBoard(await fetchBoard(BOARD_CATALOG));
        return json(res, 200, { ok: true, catalog: full });
      }

      if (action === 'list_pending_reviews') {
        var allProg = await fetchBoard(BOARD_PROGRESS);
        var pending = [];
        var seenP = {};
        allProg.forEach(function (n) {
          var msg = parseMsg(n && n.message);
          if (!msg || msg.kind !== 'task_progress') return;
          if (msg.status !== 'pending_review') return;
          var key = normUser(msg.username || msg.user) + '|' + String(msg.task_id);
          if (seenP[key] && Number(seenP[key].updated_at || 0) >= Number(msg.updated_at || 0)) return;
          seenP[key] = msg;
        });
        Object.keys(seenP).forEach(function (k) { pending.push(seenP[k]); });
        pending.sort(function (a, b) { return Number(b.submitted_at || 0) - Number(a.submitted_at || 0); });
        return json(res, 200, { ok: true, pending: pending });
      }

      if (action === 'create_task' || action === 'update_task') {
        var incoming = normalizeTask(body.task || body);
        if (!incoming || !incoming.id) return json(res, 400, { ok: false, error: 'need_task' });
        incoming.updated_at = Date.now();
        if (action === 'create_task') incoming.created_at = Date.now();
        await postBoard(BOARD_CATALOG, 'admin', 'task_def', incoming.id, {
          kind: 'task_def',
          task: incoming,
          at: Date.now()
        });
        return json(res, 200, { ok: true, task: incoming });
      }

      if (action === 'deactivate_task' || action === 'activate_task') {
        var tid2 = String(body.task_id || body.id || '').trim().slice(0, 80);
        if (!tid2) return json(res, 400, { ok: false, error: 'need_task_id' });
        var existingCat = catalogFromBoard(await fetchBoard(BOARD_CATALOG));
        var foundT = null;
        for (var x = 0; x < existingCat.length; x++) {
          if (existingCat[x].id === tid2) { foundT = existingCat[x]; break; }
        }
        if (!foundT) return json(res, 404, { ok: false, error: 'task_not_found' });
        foundT.active = action === 'activate_task';
        foundT.updated_at = Date.now();
        await postBoard(BOARD_CATALOG, 'admin', 'task_def', tid2, {
          kind: 'task_def',
          task: foundT,
          at: Date.now()
        });
        return json(res, 200, { ok: true, task: foundT });
      }

      if (action === 'set_category_active') {
        var catName = String(body.category || '').trim().toLowerCase().slice(0, 64);
        var catActive = body.active !== false && body.active !== 0 && body.active !== '0';
        if (!catName) return json(res, 400, { ok: false, error: 'need_category' });
        var catList = catalogFromBoard(await fetchBoard(BOARD_CATALOG));
        var updated = [];
        for (var ci = 0; ci < catList.length; ci++) {
          if (String(catList[ci].category).toLowerCase() !== catName) continue;
          catList[ci].active = catActive;
          catList[ci].updated_at = Date.now();
          await postBoard(BOARD_CATALOG, 'admin', 'task_def', catList[ci].id, {
            kind: 'task_def',
            task: catList[ci],
            at: Date.now()
          });
          updated.push(catList[ci].id);
        }
        return json(res, 200, { ok: true, category: catName, active: catActive, updated: updated });
      }

      if (action === 'approve_submission' || action === 'reject_submission') {
        var targetUser = normUser(body.target_user || body.username || body.user || '');
        var taskKey = String(body.task_id || '').trim().slice(0, 80);
        if (!targetUser || !taskKey) return json(res, 400, { ok: false, error: 'need_user_and_task' });
        var lockA = 'review|' + targetUser + '|' + taskKey;
        if (locks.get(lockA)) return json(res, 409, { ok: false, error: 'in_progress' });
        locks.set(lockA, Date.now());
        try {
          var tdef2 = null;
          var cats2 = catalogFromBoard(await fetchBoard(BOARD_CATALOG));
          for (var y = 0; y < cats2.length; y++) {
            if (cats2[y].id === taskKey) { tdef2 = cats2[y]; break; }
          }
          if (!tdef2) return json(res, 404, { ok: false, error: 'task_not_found' });
          var progU = progressRowsForUser(await fetchBoard(BOARD_PROGRESS), targetUser)
            .filter(function (p) { return p.task_id === taskKey; })[0];
          if (!progU) return json(res, 404, { ok: false, error: 'progress_not_found' });
          if (progU.status === 'completed' && action === 'approve_submission') {
            return json(res, 200, { ok: true, reused: true, status: 'completed', points_awarded: progU.points_awarded || 0 });
          }
          var approved = action === 'approve_submission';
          var pointsAwarded = 0;
          if (approved) {
            var refId = 'task_complete:' + taskKey;
            var ptsBoard = await fetchBoard(BOARD_POINTS);
            var prior = findPointsEvent(ptsBoard, targetUser, 'task_complete', refId);
            if (prior) {
              pointsAwarded = Number(prior.amount) || tdef2.points;
            } else {
              pointsAwarded = tdef2.points;
              var balNow = pointsBalance(ptsBoard, targetUser).balance + pointsAwarded;
              await postBoard(BOARD_POINTS, targetUser, 'points_event', refId, {
                kind: 'points_event',
                username: targetUser,
                user: targetUser,
                action: 'task_complete',
                amount: pointsAwarded,
                balance_after: balNow,
                task_id: taskKey,
                ref_id: refId,
                at: Date.now()
              });
            }
          }
          var reviewPayload = Object.assign({}, progU, {
            kind: 'task_progress',
            status: approved ? 'completed' : 'rejected',
            points_awarded: approved ? pointsAwarded : 0,
            reviewer: 'admin',
            review_note: String(body.note || body.reason || '').slice(0, 500),
            reviewed_at: Date.now(),
            updated_at: Date.now()
          });
          await postBoard(BOARD_PROGRESS, 'admin', approved ? 'task_approved' : 'task_rejected', progU.id || taskKey, reviewPayload);
          try {
            await postBoard(targetUser, 'admin', approved ? 'task_approved' : 'task_rejected', progU.id || taskKey, {
              task_id: taskKey,
              status: reviewPayload.status,
              points: pointsAwarded,
              message: approved
                ? ('Task approved · +' + pointsAwarded + ' points')
                : ('Task rejected · ' + (reviewPayload.review_note || 'see admin note'))
            });
          } catch (e) {}
          return json(res, 200, {
            ok: true,
            status: reviewPayload.status,
            points_awarded: pointsAwarded,
            progress: reviewPayload
          });
        } finally {
          locks.delete(lockA);
        }
      }

      if (action === 'user_points') {
        var uq = normUser(body.target_user || body.username || body.user || '');
        if (!uq) return json(res, 400, { ok: false, error: 'need_user' });
        var up = pointsBalance(await fetchBoard(BOARD_POINTS), uq);
        var upProg = progressRowsForUser(await fetchBoard(BOARD_PROGRESS), uq);
        return json(res, 200, {
          ok: true,
          user: uq,
          points: up.balance,
          history: up.history,
          progress: upProg,
          completed: upProg.filter(function (p) { return p.status === 'completed'; }),
          pending: upProg.filter(function (p) { return p.status === 'pending_review'; }),
          rejected: upProg.filter(function (p) { return p.status === 'rejected'; })
        });
      }

      if (action === 'list_rewards') {
        return json(res, 200, {
          ok: true,
          rewards: rewardsFromBoard(await fetchBoard(BOARD_REWARDS)),
          exposure_rewards_active: false,
          redeem_allowed: false
        });
      }

      if (action === 'set_reward') {
        var rid = String(body.id || (body.reward && body.reward.id) || '').trim().slice(0, 80);
        if (!rid) return json(res, 400, { ok: false, error: 'need_reward_id' });
        var currentRewards = rewardsFromBoard(await fetchBoard(BOARD_REWARDS));
        var baseR = null;
        for (var ri = 0; ri < currentRewards.length; ri++) {
          if (currentRewards[ri].id === rid) { baseR = currentRewards[ri]; break; }
        }
        var reward = {
          id: rid,
          name: String((body.name != null ? body.name : (body.reward && body.reward.name)) || (baseR && baseR.name) || rid).slice(0, 120),
          description: String((body.description != null ? body.description : (body.reward && body.reward.description)) || (baseR && baseR.description) || '').slice(0, 2000),
          points_cost: Math.max(0, Number(body.points_cost != null ? body.points_cost : (body.reward && body.reward.points_cost) || (baseR && baseR.points_cost) || 0) || 0),
          kind: String(body.kind || (body.reward && body.reward.kind) || (baseR && baseR.kind) || 'exposure'),
          enabled: !!(body.enabled === true || body.enabled === 1 || (body.reward && body.reward.enabled)),
          published: !!(body.published === true || body.published === 1 || (body.reward && body.reward.published)),
          config: body.config || (body.reward && body.reward.config) || (baseR && baseR.config) || {},
          updated_at: Date.now()
        };
        // Safety: never auto-publish exposure/recording rewards from incomplete payloads
        if (reward.kind === 'recording' || reward.kind === 'exposure') {
          if (body.force_publish !== true) {
            // Allow admin to set flags explicitly; default keep unpublished unless both set
          }
        }
        await postBoard(BOARD_REWARDS, 'admin', 'reward_def', rid, {
          kind: 'reward_def',
          reward: reward,
          at: Date.now()
        });
        return json(res, 200, {
          ok: true,
          reward: reward,
          note: 'Exposure rewards stay off for end users until enabled AND published'
        });
      }

      return json(res, 400, { ok: false, error: 'unknown_admin_action' });
    }

    // Explicitly block redeem until future activation
    if (action === 'redeem_reward' || action === 'claim_reward') {
      return json(res, 403, {
        ok: false,
        error: 'rewards_disabled',
        message: 'Public exposure rewards are not active yet'
      });
    }

    return json(res, 400, { ok: false, error: 'unknown_action', action: action });
  } catch (e) {
    return json(res, 500, { ok: false, error: (e && e.message) || 'server_error' });
  }
};

module.exports.SEED_CATALOG = SEED_CATALOG;
module.exports.SEED_REWARDS = SEED_REWARDS;
module.exports.normalizeTask = normalizeTask;
module.exports.catalogFromBoard = catalogFromBoard;
module.exports.pointsBalance = pointsBalance;
module.exports.mergeCatalogStatus = mergeCatalogStatus;
module.exports.statusLabel = statusLabel;
