// electron-builder afterPack hook (macOS only): sign the app ad hoc.
// Without a Developer ID electron-builder leaves the bundle unsigned after changing
// it, and Apple Silicon then reports it as "damaged". Ad hoc signed, macOS shows the
// usual "Apple could not verify…" and System Settings → Privacy & Security → Open Anyway works.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log(`  • signed ad hoc: ${app}`);
};
