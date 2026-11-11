# Homebrew Cask for Mic Clean, served straight from this repository (no separate tap):
#
#   brew tap mohamedjs/mic-clean https://github.com/mohamedjs/mic-clean
#   brew install --cask mic-clean
#
# It always installs the latest release: each release also carries the macOS zips
# under fixed names (Mic-Clean-macos-arm64.zip / Mic-Clean-macos-x64.zip).
# Update with `brew upgrade --cask --greedy mic-clean`.
cask "mic-clean" do
  arch arm: "arm64", intel: "x64"

  version :latest
  sha256 :no_check

  url "https://github.com/mohamedjs/mic-clean/releases/latest/download/Mic-Clean-macos-#{arch}.zip"
  name "Mic Clean"
  desc "Clean up any microphone: double RNNoise, EQ, compressor and limiter"
  homepage "https://mohamedjs.github.io/mic-clean/"

  depends_on macos: ">= :monterey"
  # The virtual mic that Zoom/OBS record from. The clean audio is played into it.
  depends_on cask: "blackhole-2ch"

  app "Mic Clean.app"

  # Not notarised yet (that needs a paid Apple Developer ID): without this,
  # Gatekeeper says "Mic Clean" Not Opened / Apple could not verify it.
  postflight do
    system_command "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "#{appdir}/Mic Clean.app"]
  end

  uninstall quit: "io.github.mohamedjs.micclean"

  zap trash: [
    "~/Library/Application Support/Mic Clean",
    "~/.config/mic-clean-dashboard",
  ]
end
