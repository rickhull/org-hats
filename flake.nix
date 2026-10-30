{
  description = "org-hats development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_24
            pnpm_11
            git
            # rg with the short -r pitfall closed: -r is --replace, not
            # recursion (rg recurses by default), and the silent output
            # corruption becomes a loud refusal. Spell a real replacement
            # as --replace (AGENTS.md). This wrapper is the only rg on the
            # devshell PATH; it execs the real binary.
            (writeShellScriptBin "rg" ''
              for arg in "$@"; do
                case "$arg" in
                  --) break ;;
                  -*)
                    if [[ "$arg" =~ ^-[^-]*r ]]; then
                      echo "rg: '$arg' carries the short -r, which is --replace, not recursion — rg recurses by default (AGENTS.md)" >&2
                      exit 2
                    fi
                    ;;
                esac
              done
              exec ${lib.getExe ripgrep} "$@"
            '')
            python3
            forgejo-cli
            jq
            nixfmt
          ];
          shellHook = ''
            export WRANGLER_SEND_METRICS=false
            echo "org-hats: Node $(node --version), pnpm $(pnpm --version), $(fj version)"
          '';
        };
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
