"use strict";
// .claude/hooks/lib/read-mode-file.js
// HN-19 F1/F2 — decode TOLERANTE de mode-files (.claude/state/*-mode, *-threshold).
//
// Causa-raiz do bug 2 do route-orphan-check (D-HN19-ROUTE-ORPHAN-WORKTREE): `echo >` /
// Out-File no PowerShell 5.1 grava UTF-16 LE com BOM; os hooks liam
// `readFileSync(modeFile, "utf8").trim()` → o valor vinha com BOM + NUL embutido,
// NUNCA casava "soft"/"hard" → o guard silenciava sem ninguem perceber.
//
// Esta lib normaliza BOM UTF-16 LE/BE + UTF-8 BOM + strip de NUL embutido. Nasce
// compartilhada: a classe UTF-16/BOM esta viva em 10+ hooks (D-HN19-MODE-DECODE-SWEEP);
// F2/T6 migra o route-orphan p/ ca, o sweep dos demais e debito nomeado.
//
// CJS (module.exports) p/ interop tanto com hooks ESM (import) quanto CJS (require).
// Source 100% ASCII: control chars via charCodeAt/fromCharCode (nunca bytes crus).

const fs = require("node:fs");

const NUL = 0x00;
const BOM = 0xfeff;

function stripControl(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === NUL) continue; // NUL embutido (artefato UTF-16 lido errado)
    if (i === 0 && c === BOM) continue; // BOM residual no inicio
    out += text[i];
  }
  return out.trim();
}

function hasNul(text) {
  for (let i = 0; i < text.length; i++)
    if (text.charCodeAt(i) === NUL) return true;
  return false;
}

// Buffer bruto → { value, recovered, encoding }. `recovered` = precisou corrigir encoding.
function decodeModeBuffer(buf) {
  let text;
  let encoding = "utf8";
  let recovered = false;
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    text = buf.toString("utf16le", 2);
    encoding = "utf16le-bom";
    recovered = true;
  } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16(); // UTF-16 BE → LE
    text = swapped.toString("utf16le");
    encoding = "utf16be-bom";
    recovered = true;
  } else if (
    buf.length >= 3 &&
    buf[0] === 0xef &&
    buf[1] === 0xbb &&
    buf[2] === 0xbf
  ) {
    text = buf.toString("utf8", 3);
    encoding = "utf8-bom";
    recovered = true;
  } else {
    text = buf.toString("utf8");
    if (hasNul(text)) {
      // NUL embutido sem BOM = UTF-16 LE sem marca (Out-File default de PS antigo)
      text = buf.toString("utf16le");
      encoding = "utf16le-nobom";
      recovered = true;
    }
  }
  return { value: stripControl(text), recovered, encoding };
}

// Le um mode-file com decode tolerante. opts.default = valor se ausente/vazio.
function readModeFile(filePath, opts = {}) {
  const fallback = opts.default !== undefined ? opts.default : "";
  try {
    const { value, recovered, encoding } = decodeModeBuffer(
      fs.readFileSync(filePath),
    );
    return { value: value || fallback, recovered, encoding, found: true };
  } catch {
    return {
      value: fallback,
      recovered: false,
      encoding: "absent",
      found: false,
    };
  }
}

module.exports = { decodeModeBuffer, readModeFile };
