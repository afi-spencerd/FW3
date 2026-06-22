{
  description = "fw3 ERP — TypeScript monorepo dev shell (NixOS)";

  # Use the indirect `nixpkgs` registry ref so versions match the host channel
  # (the same source that resolves prisma-engines 7.8.0 / node 22 / pnpm 11).
  inputs.nixpkgs.url = "nixpkgs";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAll = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forAll (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.just      # task runner
              pkgs.nodejs_22 # current LTS — not Bun (locked decision)
              pkgs.pnpm # workspace package manager
              pkgs.openssl # Prisma + node tls
              pkgs.prisma-engines # provides schema-engine for migrations
            ];

            # --- Prisma on NixOS ---
            # Prisma would otherwise download prebuilt engine binaries that won't
            # run against the NixOS dynamic linker. Prisma 7 uses the driver-adapter
            # model (no Rust query-engine binary at runtime), so the ONLY engine we
            # still need is `schema-engine` for migrations — point it at the
            # nixpkgs build. Pinned to npm prisma 7.8.0 to match prisma-engines.
            PRISMA_SCHEMA_ENGINE_BINARY = "${pkgs.prisma-engines}/bin/schema-engine";

            shellHook = ''
              export PRISMA_SCHEMA_ENGINE_BINARY="${pkgs.prisma-engines}/bin/schema-engine"
              echo "fw3 dev shell · node $(node --version) · pnpm $(pnpm --version)"
              echo "  prisma schema-engine: $PRISMA_SCHEMA_ENGINE_BINARY"
            '';
          };
        });
    };
}
