# Build locally only. Contains code and tooling, never credentials or runtime state.
FROM getoyi-hardware-signing:9b5388c
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 iptables ca-certificates && rm -rf /var/lib/apt/lists/*
COPY release/provider-execution/ /app/backend/release/provider-execution/
COPY dist/commerce/ /app/backend/dist/commerce/
WORKDIR /app/backend
ENV HARDWARE_BOUNDED_EXECUTION_ENABLED=false PROVIDER_FINANCIAL_RELAY_ENABLED=false PROVIDER_FINANCIAL_EXECUTION_ENABLED=false
CMD ["node","release/provider-execution/execution-server.cjs"]
