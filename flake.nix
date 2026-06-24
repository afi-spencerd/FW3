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
      packages = forAll (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          nodejs = pkgs.nodejs_22;
          pnpm = pkgs.pnpm; # 11.x, matches the repo packageManager + lockfile v9

          # One offline pnpm store for the whole workspace (root + apps + packages).
          # `src = self` is the git-tracked tree (no node_modules / dist). Fill the
          # hash from the first build error (the fakeHash workflow).
          pnpmDeps = pnpm.fetchDeps {
            pname = "fw3";
            version = "0.0.0";
            fetcherVersion = 3;
            src = self;
            hash = "sha256-dJDF+ny1I44KdvCE9T5x9rFTSi0TljvGH6Fzup6oB4E=";
          };

          # Dummy connection string: prisma.config.ts references DATABASE_URL at load,
          # but `prisma generate` (pure codegen in Prisma 7) never connects.
          dummyDbUrl =
            "sqlserver://localhost:1433;database=fw3;user=sa;password=x;encrypt=true;trustServerCertificate=true";
        in
        rec {
          default = api;

          # Static Vue/Vite SPA → $out is the servable web root.
          web = pkgs.stdenv.mkDerivation (finalAttrs: {
            pname = "fw3-web";
            version = "0.0.0";
            src = self;
            inherit pnpmDeps;
            nativeBuildInputs = [ nodejs pnpm pnpm.configHook ];
            buildPhase = ''
              runHook preBuild
              pnpm --filter @fw3/shared-types build
              pnpm --filter @fw3/web build
              runHook postBuild
            '';
            installPhase = ''
              runHook preInstall
              cp -r apps/web/dist $out
              runHook postInstall
            '';
          });

          # NestJS server as a self-contained artifact: built dist + generated Prisma
          # client + production node_modules + a `bin/fw3-api` wrapper on pinned Node.
          api = pkgs.stdenv.mkDerivation (finalAttrs: {
            pname = "fw3-api";
            version = "0.0.0";
            src = self;
            inherit pnpmDeps;
            nativeBuildInputs = [ nodejs pnpm pnpm.configHook pkgs.makeWrapper ];
            env = {
              DATABASE_URL = dummyDbUrl;
              PRISMA_SCHEMA_ENGINE_BINARY = "${pkgs.prisma-engines}/bin/schema-engine";
            };
            buildPhase = ''
              runHook preBuild
              pnpm --filter @fw3/shared-types build
              pnpm --filter @fw3/api exec prisma generate
              pnpm --filter @fw3/api build
              runHook postBuild
            '';
            installPhase = ''
              runHook preInstall
              dest=$out/libexec/fw3-api
              mkdir -p "$dest"
              # Portable tree with prod-only deps (workspace deps injected). The
              # modern deploy clones from the already-installed store without
              # re-resolving from the registry (offline); injecting the workspace
              # dep (@fw3/shared-types) is required by pnpm v10+ deploy.
              pnpm --filter @fw3/api --prod --offline \
                --config.inject-workspace-packages=true deploy "$dest"
              # Ensure the compiled output + generated client are present.
              rm -rf "$dest/dist" && cp -r apps/api/dist "$dest/dist"
              rm -rf "$dest/src/generated" && mkdir -p "$dest/src" \
                && cp -r apps/api/src/generated "$dest/src/generated"
              makeWrapper ${nodejs}/bin/node $out/bin/fw3-api \
                --add-flags "$dest/dist/src/main.js"
              runHook postInstall
            '';
          });
        });

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
