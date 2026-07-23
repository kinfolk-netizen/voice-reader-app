/**
 * gen-lexicon-artifacts.js — derive deployable artifacts from the saga lexicon.
 *
 * Single source of truth: public/score/saga-lexicon.json
 * Emits: public/score/saga-lexicon.pls  (W3C Pronunciation Lexicon Specification)
 *
 * The .pls is ALIAS-based so it applies on every ElevenLabs model, including
 * eleven_multilingual_v2 (our narration model). Phoneme (<phoneme>) entries
 * would only apply on flash_v2/v3, so v1.0 ships alias-only for universal effect;
 * ipa in the lexicon is carried for a later phoneme variant.
 *
 * buildPls() is a PURE function of the lexicon so test_lexicon.js can assert the
 * committed .pls has not drifted from the JSON.
 *
 * Run directly to (re)write the .pls:  node devtest/gen-lexicon-artifacts.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Pure: lexicon object -> .pls text. Deterministic (order follows the lexicon).
function buildPls(lexicon) {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<lexicon version="1.0"');
  lines.push('  xmlns="http://www.w3.org/2005/01/pronunciation-lexicon"');
  lines.push('  alphabet="ipa" xml:lang="en-US">');
  lines.push('  <!-- Generated from saga-lexicon.json v' + lexicon.version + ' — do not hand-edit; run devtest/gen-lexicon-artifacts.js -->');
  for (const c of lexicon.characters) {
    // One <lexeme> per matchable spelling, all aliased to the same respelling,
    // so "Ka'el", "Ka’el" and "Kael" all resolve identically.
    for (const g of c.match) {
      lines.push('  <lexeme>');
      lines.push('    <grapheme>' + xmlEscape(g) + '</grapheme>');
      lines.push('    <alias>' + xmlEscape(c.alias) + '</alias>');
      lines.push('  </lexeme>');
    }
  }
  lines.push('</lexicon>');
  return lines.join('\n') + '\n';
}

module.exports = { buildPls, xmlEscape };

if (require.main === module) {
  const lexPath = path.join(__dirname, '..', 'public', 'score', 'saga-lexicon.json');
  const outPath = path.join(__dirname, '..', 'public', 'score', 'saga-lexicon.pls');
  const lexicon = JSON.parse(fs.readFileSync(lexPath, 'utf8'));
  const pls = buildPls(lexicon);
  fs.writeFileSync(outPath, pls);
  console.log('Wrote ' + outPath + ' (' + Buffer.byteLength(pls) + ' bytes, ' +
    lexicon.characters.reduce((n, c) => n + c.match.length, 0) + ' lexemes)');
}
