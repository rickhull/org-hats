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
            ripgrep
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
