FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends iptables ca-certificates && rm -rf /var/lib/apt/lists/*
COPY egress.cjs /egress.cjs
ENV PROVIDER_PREPARATION_ONLY=true
CMD ["node","/egress.cjs"]
