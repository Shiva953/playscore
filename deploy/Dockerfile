# Score backend (devnet): score-node (Rust) + oracle (Bun), one image, two Railway services.
# START=node | oracle picks the process. Keys come from env (see deploy/entrypoint.sh), state lives on /data.
FROM rust:1.92-bookworm AS rust
WORKDIR /src
COPY engine engine
COPY anchor/programs anchor/programs
COPY anchor/Cargo.toml anchor/Cargo.toml
COPY backend backend
RUN rm -f anchor/rust-toolchain.toml && cargo build --release --manifest-path backend/Cargo.toml

FROM oven/bun:1.2.22-debian
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY packages packages
RUN bun install --frozen-lockfile --ignore-scripts
COPY src src
COPY services services
COPY --from=rust /src/backend/target/release/score-node /app/score-node
COPY deploy/entrypoint.sh /app/entrypoint.sh
COPY deploy/seed /app/seed
ENTRYPOINT ["/app/entrypoint.sh"]
