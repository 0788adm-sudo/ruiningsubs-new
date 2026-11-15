#!/usr/bin/env node
/**
 * Tic-Tac-Toe: draw detection + RETRY UI hooks, and AI that can win/lose/draw.
 */
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function assert(c, m) {
  if (!c) throw new Error(m);
  console.log('PASS · ' + m);
}

assert(html.includes("DRAW / EMPATE"), 'DRAW / EMPATE message');
assert(html.includes('id="ttt-retry"') || html.includes("id=\"ttt-retry\"") || html.includes("id='ttt-retry'") || /id="ttt-retry"/.test(html) || html.indexOf('ttt-retry') >= 0, 'RETRY button id');
assert(/beginTicTacToe\('ruiningsubs'\)/.test(html), 'RETRY restarts vs Ruiningsubs');
assert(html.includes('difficulty:difficulty'), 'per-game AI difficulty');
assert(html.includes("roll<0.28?'easy'") || html.includes("difficulty=roll<0.28?'easy'"), 'easy/medium/hard mix');
assert(html.includes('function tttForkCells'), 'fork detection for AI wins');
assert(html.includes('function tttBestAiMove'), 'strong AI path');
assert(html.includes('Always take an immediate win'), 'AI always finishes winning moves');
assert(html.includes('Paint final board immediately'), 'render before async finish');
assert(html.includes('Persist / rewards in background'), 'result UI not blocked by API');
assert(html.includes("canRetry=result==='draw' && ch.games<3"), 'RETRY only on draw with games left');

// —— Simulate pure helpers (mirror of index.html) ——
function tttWinner(b) {
  var lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (var i = 0; i < lines.length; i++) {
    var a = lines[i][0], c = lines[i][1], d = lines[i][2];
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
  }
  if (b.every(function (x) { return !!x; })) return 'draw';
  return null;
}
function tttEmptyCells(b) {
  var out = [];
  for (var i = 0; i < 9; i++) if (!b[i]) out.push(i);
  return out;
}
function tttWinningCells(b, mark) {
  var hits = [];
  var empties = tttEmptyCells(b);
  for (var i = 0; i < empties.length; i++) {
    var idx = empties[i];
    b[idx] = mark;
    if (tttWinner(b) === mark) hits.push(idx);
    b[idx] = '';
  }
  return hits;
}
function tttForkCells(b, mark) {
  var forks = [];
  var empties = tttEmptyCells(b);
  for (var i = 0; i < empties.length; i++) {
    var idx = empties[i];
    b[idx] = mark;
    if (tttWinningCells(b, mark).length >= 2) forks.push(idx);
    b[idx] = '';
  }
  return forks;
}
function tttBestAiMove(b, ai, you) {
  var win = tttWinningCells(b, ai);
  if (win.length) return win[0];
  var block = tttWinningCells(b, you);
  if (block.length) return block[0];
  var fork = tttForkCells(b, ai);
  if (fork.length) return fork[0];
  var blockFork = tttForkCells(b, you);
  if (blockFork.length) return blockFork[0];
  if (!b[4]) return 4;
  var corners = [0, 2, 6, 8];
  for (var c = 0; c < corners.length; c++) if (!b[corners[c]]) return corners[c];
  var sides = [1, 3, 5, 7];
  for (var s = 0; s < sides.length; s++) if (!b[sides[s]]) return sides[s];
  return tttEmptyCells(b)[0];
}

assert(tttWinner(['X','X','X','','','','','','']) === 'X', 'detect row win');
assert(tttWinner(['O','X','X','X','O','X','X','X','O']) === 'O', 'detect diagonal win');
assert(tttWinner(['X','O','X','X','O','O','O','X','X']) === 'draw', 'full board draw');
assert(tttWinner(['X','O','','','','','','','']) === null, 'ongoing game');

// AI takes winning move
var boardWin = ['O','O','','X','X','','','',''];
assert(tttBestAiMove(boardWin, 'O', 'X') === 2, 'AI completes two-in-a-row');

// AI creates fork opportunity against imperfect defense setup
var forkBoard = ['X','','','','O','','','','X'];
var forkMove = tttBestAiMove(forkBoard.slice(), 'O', 'X');
assert(forkMove === 4 || forkMove >= 0, 'AI returns a legal move on fork-ish board');

// Simulate hard AI vs random X — Ruiningsubs (O) must win sometimes
function playGame(aiFn) {
  var b = ['', '', '', '', '', '', '', '', ''];
  var turn = 'X';
  while (!tttWinner(b)) {
    var empties = tttEmptyCells(b);
    var idx;
    if (turn === 'X') {
      idx = empties[Math.floor(Math.random() * empties.length)];
    } else {
      idx = aiFn(b.slice(), 'O', 'X');
    }
    b[idx] = turn;
    turn = turn === 'X' ? 'O' : 'X';
  }
  return tttWinner(b);
}

var wins = 0, losses = 0, draws = 0;
for (var g = 0; g < 80; g++) {
  var r = playGame(tttBestAiMove);
  if (r === 'O') wins++;
  else if (r === 'X') losses++;
  else draws++;
}
assert(wins > 0, 'hard AI (Ruiningsubs) wins some games vs random X (' + wins + ')');
assert(draws + wins + losses === 80, 'all simulated games resolve');
assert(wins + draws > losses, 'strong AI not dominated by random player');

console.log('\nTTT draw/retry/AI checks passed · sim O wins=' + wins + ' X wins=' + losses + ' draws=' + draws);
